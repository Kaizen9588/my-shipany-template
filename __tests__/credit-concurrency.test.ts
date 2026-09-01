import { readFileSync } from "fs";
import path from "path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(process.cwd(), "data", "migrations");

describe("decrease_credits 并发安全（P0-2，静态断言）", () => {
  it("0020 迁移在余额校验前取用户级事务 advisory lock", () => {
    const sql = readFileSync(
      path.join(MIGRATIONS_DIR, "0020_decrease_credits_user_lock.sql"),
      "utf8"
    );

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("hashtext(p_user_uuid)");

    // advisory lock 必须先于 FOR UPDATE 行锁与 SUM 余额校验，否则串行化不成立
    // （从 lock 位置向后查找，避开文件头注释里提到的 "FOR UPDATE" 字样）
    const lockIdx = sql.indexOf("pg_advisory_xact_lock");
    const rowLockIdx = sql.indexOf("FOR UPDATE", lockIdx);
    const balanceIdx = sql.indexOf("SUM(credits)", lockIdx);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(rowLockIdx).toBeGreaterThan(lockIdx);
    expect(balanceIdx).toBeGreaterThan(lockIdx);
  });
});

/**
 * 并发回归：需要真实 Postgres，未配置 TEST_DATABASE_URL 时整体跳过。
 * 只对合成 user_uuid 写 credits 行，结束后清理，不触碰 schema。
 */
describe.skipIf(!TEST_DATABASE_URL)(
  "decrease_credits 并发回归（P0-2，需 TEST_DATABASE_URL）",
  () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
    const seededUsers: string[] = [];

    function makeUserUuid(): string {
      const uuid = `test-p02-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      seededUsers.push(uuid);
      return uuid;
    }

    /** credits.user_uuid 外键指向 users.uuid，测试用户先落 users 行（真实并发用例） */
    async function ensureUser(userUuid: string): Promise<void> {
      await pool.query(
        `INSERT INTO users (uuid, email, created_at, invite_code, is_affiliate)
         VALUES ($1, $2, now(), '', false)
         ON CONFLICT (uuid) DO NOTHING`,
        [userUuid, `${userUuid}@test.local`]
      );
    }

    async function seedCredits(
      userUuid: string,
      rows: { credits: number; expiredAt?: Date | null }[]
    ): Promise<void> {
      await ensureUser(userUuid);
      for (const row of rows) {
        const transNo = `t-${userUuid}-${Math.random().toString(36).slice(2, 12)}`;
        await pool.query(
          `INSERT INTO credits (trans_no, created_at, user_uuid, trans_type, credits, order_no, expired_at)
           VALUES ($1, now(), $2, 'order_pay', $3, '', $4)`,
          [transNo, userUuid, row.credits, row.expiredAt ?? null]
        );
        // 迁移 0026 后 decrease_credits 走 credit_lots 批次 FIFO，发放必须同步建批次
        await pool.query(
          `INSERT INTO credit_lots (lot_no, user_uuid, source_type, source_ref, total_credits, remaining_credits, expired_at)
           VALUES ($1, $2, 'order_pay', '', $3, $3, $4)
           ON CONFLICT (lot_no) DO NOTHING`,
          [`lot-${transNo}`, userUuid, row.credits, row.expiredAt ?? null]
        );
      }
    }

    async function getBalance(userUuid: string): Promise<number> {
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(credits), 0) AS balance FROM credits WHERE user_uuid = $1`,
        [userUuid]
      );
      return Number(rows[0].balance);
    }

    /** 独立事务执行一次扣减；RPC 抛错则回滚并返回失败。
     *  N-2（迁移 0023）后 decrease_credits 只存在于 private schema，裸 SELECT 不可达，
     *  这里显式以 private. 前缀调用（与生产 serverClient().schema("private") 对齐）。 */
    async function tryDecrease(
      userUuid: string,
      credits: number
    ): Promise<{ ok: boolean; message: string }> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT private.decrease_credits($1, $2, $3, $4)", [
          userUuid,
          "test",
          credits,
          `t-${userUuid}-${Math.random().toString(36).slice(2, 12)}`,
        ]);
        await client.query("COMMIT");
        return { ok: true, message: "" };
      } catch (e) {
        await client.query("ROLLBACK");
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      } finally {
        client.release();
      }
    }

    it("并发扣减同一账户不会双花：余额 10、5 个并发扣 4，恰好 2 个成功", async () => {
      const userUuid = makeUserUuid();
      await seedCredits(userUuid, [{ credits: 10 }]);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => tryDecrease(userUuid, 4))
      );

      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      expect(succeeded).toHaveLength(2);
      expect(failed).toHaveLength(3);
      for (const f of failed) {
        expect(f.message).toContain("insufficient credits");
      }
      // 账本最终净额必须精确等于 10 - 2*4，任何双花都会让净额更低
      await expect(getBalance(userUuid)).resolves.toBe(2);
    }, 20000);

    it("账本为空（无行可锁）时并发扣减全部失败，不产生负数流水", async () => {
      const userUuid = makeUserUuid();
      await ensureUser(userUuid);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => tryDecrease(userUuid, 1))
      );

      expect(results.every((r) => !r.ok)).toBe(true);
      await expect(getBalance(userUuid)).resolves.toBe(0);
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM credits WHERE user_uuid = $1",
        [userUuid]
      );
      expect(rows[0].n).toBe(0);
    }, 20000);

    it("扣减成功后负数流水 expired_at 为 NULL（永久消费，不随原积分过期复活）", async () => {
      const userUuid = makeUserUuid();
      await seedCredits(userUuid, [{ credits: 5 }]);

      const result = await tryDecrease(userUuid, 3);
      expect(result.ok).toBe(true);

      const { rows } = await pool.query(
        `SELECT credits, expired_at FROM credits
         WHERE user_uuid = $1 AND credits < 0`,
        [userUuid]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].credits).toBe(-3);
      expect(rows[0].expired_at).toBeNull();
    }, 20000);

    afterAll(async () => {
      if (seededUsers.length > 0) {
        await pool.query("DELETE FROM credit_consumptions WHERE user_uuid = ANY($1)", [
          seededUsers,
        ]);
        await pool.query("DELETE FROM credit_lots WHERE user_uuid = ANY($1)", [
          seededUsers,
        ]);
        await pool.query("DELETE FROM credits WHERE user_uuid = ANY($1)", [
          seededUsers,
        ]);
        await pool.query("DELETE FROM users WHERE uuid = ANY($1)", [
          seededUsers,
        ]);
      }
      await pool.end();
    });
  }
);
