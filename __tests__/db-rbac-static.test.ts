import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * N-2 / N-3 静态断言（无需连库）：
 * 资金/权限敏感路径（services/refund、services/credit、services/order、
 * lib/payment）是服务端权威执行点，必须显式走 serverClient()（service_role，
 * 绕 RLS），不得通过可被“配置了 service key”隐式升级的 getSupabaseClient()，
 * 也不得走 userClient()（anon）。
 * 对应 docs/03 §「生产必须满足的数据库权限基线」第 4、5 条。
 *
 * 若未来把资金函数迁到 private schema 并只授权 service_role，本断言会兜住
 * “调用点被误改成 anon/用户路径”的回归。
 */

/** 资金/特权路径：允许且只允许 serverClient */
const fundsFiles = [
  "services/refund.ts",
  "services/credit.ts",
  "services/order.ts",
  "lib/payment/index.ts",
  "lib/payment/providers/waffo.ts",
  "lib/payment/providers/creem.ts",
];

/** 仍允许兼容入口 getSupabaseClient 的（非资金）路径，但不得含 serverClient 之外的隐式升级 */
const fundsRpcs = [
  "decrease_credits",
  "handle_order_payment",
  "process_order_refund",
  "register_order_refund_request",
  "debt_regulate_order_refund",
  // 0028 新增：联盟奖励冲销（不在 0023 迁移清单内）
  "reverse_affiliate_reward",
];

/** 0023 批次迁入 private 的资金函数（0028 的 reverse_affiliate_reward 除外） */
const fundsRpcsM0023 = fundsRpcs.filter((r) => r !== "reverse_affiliate_reward");

function sourceOf(f: string): string {
  return readFileSync(path.join(process.cwd(), f), "utf8");
}

describe("资金路径显式走 serverClient（N-2/N-3 静态断言）", () => {
  for (const f of fundsFiles) {
    it(`${f} 不含 getSupabaseClient()/userClient()，且资金 RPC 由 serverClient() 调用`, () => {
      const src = sourceOf(f);
      expect(src).toContain("serverClient()");
      expect(src).not.toContain("getSupabaseClient()");
      expect(src).not.toContain("userClient()");
      // 该文件声明的资金 RPC 确实由 serverClient 上下文触发：
      // 逐个 serverClient() 分段检查（文件可能有多个函数各自建 client），
      // 只要任一 serverClient() 之后的段落包含该 RPC 即视为合规。
      const segments = src.split("serverClient()").slice(1);
      for (const rpc of fundsRpcs) {
        if (src.includes(`"${rpc}"`)) {
          expect(
            segments.some((seg) => seg.includes(`"${rpc}"`)),
            `RPC ${rpc} 应出现在 serverClient() 之后`
          ).toBe(true);
        }
      }
    });
  }

  it("资金 RPC 调用点固定 .schema(\"private\")（N-2 库级边界：函数已迁 private，public 无可调对象）", () => {
    // 迁移 0023 后资金函数只存在于 private schema；调用必须显式切 schema。
    // 允许段落级灵活匹配：任一 serverClient() 分段内同时出现 rpc 名与 .schema("private")。
    for (const f of [
      "services/refund.ts",
      "services/credit.ts",
      "services/order.ts",
      "lib/payment/index.ts",
    ]) {
      const src = sourceOf(f);
      const segments = src.split("serverClient()").slice(1);
      for (const rpc of fundsRpcs) {
        if (src.includes(`"${rpc}"`)) {
          const seg = segments.find((s) => s.includes(`"${rpc}"`));
          expect(
            seg?.includes('.schema("private")'),
            `${f}: RPC ${rpc} 的调用 client 应为 serverClient().schema("private")`
          ).toBe(true);
        }
      }
    }
  });

  it("迁移 0023 存在且内容完备：private schema + REVOKE PUBLIC + 仅授 service_role + 资金表 RLS", () => {
    const src = sourceOf("data/migrations/0023_private_schema_fund_rpcs.sql");
    expect(src).toContain("CREATE SCHEMA IF NOT EXISTS private");
    // 0028 的 reverse_affiliate_reward 不在此清单（其迁移断言在第十三批 describe）
    for (const rpc of fundsRpcsM0023) {
      // 函数迁入 private 且 public 旧对象删除
      expect(src).toContain(`CREATE OR REPLACE FUNCTION private.${rpc}`);
      expect(src).toContain(`DROP FUNCTION IF EXISTS public.${rpc}`);
      // REVOKE + GRANT 成对（REVOKE 不带签名即可唯一定位；GRANT 用正则匹配带签名形式）
      expect(src).toContain(`REVOKE ALL ON FUNCTION private.${rpc}`);
      expect(
        new RegExp(`GRANT EXECUTE ON FUNCTION private\\.${rpc}\\([^)]*\\) TO service_role`).test(src),
        `GRANT EXECUTE ... TO service_role for ${rpc}`
      ).toBe(true);
    }
    for (const table of ["credits", "orders", "refunds", "credit_debts"]) {
      expect(src).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("anon 直连资金表/RPC 的 Data API 暴露面收口（迁移 0023 后 RPC 不再出现在 public 暴露清单）", () => {
    // Data API 只暴露 public schema；private.* 天然不可达。此断言兜底：
    // 任何新迁移若把资金函数重新建回 public（例如复制旧定义），静态失败。
    const dir = path.join(process.cwd(), "data/migrations");
    const bad: string[] = [];
    for (const name of readFileSyncNames(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      for (const rpc of fundsRpcs) {
        if (new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${rpc}`).test(src)) {
          bad.push(`${name}: public.${rpc}`);
        }
      }
    }
    expect(bad, `资金函数不得再建回 public schema: ${bad.join(", ")}`).toEqual([]);
  });
  it("models/db 提供独立 serverClient / userClient，service key 只在 serverClient 出现", () => {
    const src = sourceOf("models/db.ts");
    expect(src).toContain("export function serverClient()");
    expect(src).toContain("export function userClient()");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    // userClient 不得接触 service key
    const userSection = src.split("userClient")[1] ?? "";
    expect(userSection).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("public 表 RLS 全量收口（迁移 0024/0025 静态断言，第十批）", () => {
  const publicTables = [
    "users",
    "apikeys",
    "affiliates",
    "notifications",
    "verification_codes",
    "anonymous_usage",
    "payment_products",
    "payment_settings",
    "posts",
    "system_settings",
    "audit_logs",
    "op_events",
    "schema_migrations",
    "creem_orders",
    "waffo_orders",
  ];
  const fundTables = ["credits", "orders", "refunds", "credit_debts"];

  it("迁移 0024 对全部 19 张 public 业务表 ENABLE RLS + REVOKE anon/authenticated", () => {
    // SQL 有对齐填充空格，按空白折叠后匹配
    const src = sourceOf("data/migrations/0024_public_tables_rls_deny_all.sql").replace(/\s+/g, " ");
    for (const t of [...publicTables, ...fundTables]) {
      // 资金四表 0023 已 ENABLE RLS，0024 只补 REVOKE——不重复 ALTER
      if (!fundTables.includes(t)) {
        expect(src).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      }
      expect(src).toContain(`REVOKE ALL ON TABLE ${t} FROM anon, authenticated`);
    }
    // anonymous_usage RPC 权限收口：EXECUTE 仅授 service_role + search_path 钉死
    for (const rpc of ["increment_anonymous_usage", "decrement_anonymous_usage"]) {
      expect(src).toContain(`REVOKE ALL ON FUNCTION public.${rpc}`);
      expect(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\([^)]*\\) TO service_role`).test(src),
        `GRANT EXECUTE ... TO service_role for ${rpc}`
      ).toBe(true);
      expect(src).toContain(`ALTER FUNCTION public.${rpc}`);
      expect(src).toContain("SET search_path");
    }
  });

  it("任何迁移不得把 anon/authenticated 的表权限重新 GRANT 回 public 表", () => {
    const dir = path.join(process.cwd(), "data/migrations");
    const bad: string[] = [];
    for (const name of readFileSyncNames(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      if (/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b[^;]*\bTO\s+(anon|authenticated)\b/i.test(src)) {
        bad.push(name);
      }
    }
    expect(bad, `不得向 anon/authenticated 重新授权: ${bad.join(", ")}`).toEqual([]);
  });

  it("迁移 0025 修复 verification_codes.code 列宽（SHA-256 hex 需 64）", () => {
    const src = sourceOf("data/migrations/0025_verification_code_hash_width.sql");
    expect(src).toContain("ALTER TABLE verification_codes ALTER COLUMN code TYPE VARCHAR(64)");
  });

  it("consumeVerificationCode 的 update 显式请求 count（否则恒 false，注册/重置全挂）", () => {
    const src = sourceOf("models/verification.ts");
    expect(src).toContain('.update({ used: true }, { count: "exact" })');
  });
});

describe("credit_lots 批次账本与退款精确准入（迁移 0026 静态断言，第十一批）", () => {
  const sql = () =>
    sourceOf("data/migrations/0026_credit_lots_refine.sql").replace(/\s+/g, " ");

  it("0026 新表 deny-all：credit_lots / credit_consumptions ENABLE RLS + REVOKE anon/authenticated", () => {
    const src = sql();
    for (const t of ["credit_lots", "credit_consumptions"]) {
      expect(src).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      expect(src).toContain(`REVOKE ALL ON TABLE ${t} FROM anon, authenticated`);
    }
  });

  it("0026 批次函数迁 private + REVOKE/GRANT 成对（grant_credit_lot / settle_credit_debt）", () => {
    const src = sql();
    for (const rpc of ["grant_credit_lot", "settle_credit_debt"]) {
      expect(src).toContain(`CREATE OR REPLACE FUNCTION private.${rpc}`);
      expect(src).toContain(`REVOKE ALL ON FUNCTION private.${rpc}`);
      expect(
        new RegExp(`GRANT EXECUTE ON FUNCTION private\\.${rpc}\\([^)]*\\) TO service_role`).test(src),
        `GRANT EXECUTE ... TO service_role for ${rpc}`
      ).toBe(true);
    }
  });

  it("0026 三个重写函数保持批次语义：FIFO 行级原子扣减 + 精确准入 + 同步建批次", () => {
    const src = sql();
    // decrease_credits：批次 FIFO（过期优先）+ 行级原子 UPDATE ... WHERE remaining >= x
    const decIdx = src.indexOf("CREATE OR REPLACE FUNCTION private.decrease_credits");
    const decBody = src.slice(decIdx, src.indexOf("-- ============ 6.", decIdx));
    expect(decBody).toContain("ORDER BY expired_at ASC NULLS LAST, id ASC");
    expect(decBody).toContain("remaining_credits >= v_take");
    expect(decBody).toContain("INSERT INTO credit_consumptions");
    // process_order_refund：按订单批次 SUM(remaining) 精确准入，锁先于快照
    const refundIdx = src.indexOf("CREATE OR REPLACE FUNCTION private.process_order_refund");
    const refundBody = src.slice(refundIdx, refundIdx + 6000);
    expect(refundBody).toContain("source_type = 'order_pay'");
    expect(refundBody).toContain("SUM(remaining_credits)");
    expect(refundBody.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
    expect(refundBody.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      refundBody.indexOf("SUM(remaining_credits)")
    );
    // handle_order_payment：发放同步建批次（同 trans_no）
    const handleIdx = src.indexOf("CREATE OR REPLACE FUNCTION private.handle_order_payment");
    const handleBody = src.slice(handleIdx, src.indexOf("-- ============ 7.", handleIdx));
    expect(handleBody).toContain("INSERT INTO credit_lots");
  });

  it("0026 保留 P0-2 用户级 advisory lock（decrease 与 refund 同键互斥）", () => {
    const src = sql();
    expect(src.match(/pg_advisory_xact_lock\(736925141, hashtext/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("发放路径（services/credit）insertCredit 后同步 grant_credit_lot，走 serverClient().schema(\"private\")", () => {
    const src = sourceOf("services/credit.ts");
    expect(src).toContain('"grant_credit_lot"');
    const grantSeg = src.split("serverClient()").slice(1).find((s) => s.includes('"grant_credit_lot"'));
    expect(grantSeg?.includes('.schema("private")')).toBe(true);
    // adjustCreditsByAdmin 正数分支也要建批次
    expect(src).toContain("if (credits > 0)");
  });
});

function readFileSyncNames(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(".sql"));
}

describe("默认管理员恢复与强制改密（迁移 0027 静态断言，第十二批）", () => {
  const sql = () =>
    sourceOf("data/migrations/0027_restore_default_admin.sql").replace(/\s+/g, " ");

  it("0027 默认管理员必须 pending_activation + must_change_password，无明文密码", () => {
    const src = sql();
    expect(src).toContain("'admin@shipany.local'");
    // 唯一允许的引导凭据形态：待激活 + 强制改密（首次登录闭环前不可用后台）
    expect(src).toContain("'pending_activation'");
    expect(src).toContain("must_change_password = true");
    expect(src).not.toMatch(/password_hash\s*=\s*'(?!\$)/); // 只允许 bcrypt 哈希入库
    // INSERT 与 UPDATE 两路径都要带强制改密标志
    expect(src.match(/must_change_password/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("getAdminUser 放行 pending_activation（banned/deleted 仍拦截），requireAdmin 挡未改密", () => {
    const src = sourceOf("lib/auth.ts").replace(/\s+/g, " ");
    expect(src).toContain('user.status !== "pending_activation"');
    expect(src).toContain('if (admin.must_change_password) { throw new Error("password change required"); }');
    // banned/deleted 拦截必须保留在 pending 放行之前
    expect(src.indexOf('user.status !== "active"')).toBeGreaterThan(-1);
    expect(src.indexOf('user.status !== "pending_activation"')).toBeGreaterThan(
      src.indexOf('user.status !== "active"')
    );
  });

  it("console layout 的 must_change_password 重定向先于 status 拦截", () => {
    const src = sourceOf("app/[locale]/(default)/(console)/layout.tsx").replace(/\s+/g, " ");
    const mustIdx = src.indexOf("userInfo.must_change_password");
    const statusIdx = src.indexOf('userInfo.status && userInfo.status !== "active"');
    expect(mustIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(-1);
    expect(mustIdx).toBeLessThan(statusIdx);
  });

  it("getUserInfo 直读 session uuid，pending_activation 管理员可达 /change-password", () => {
    const src = sourceOf("services/user.ts")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "")) // 去注释后断言代码本身
      .join("\n")
      .replace(/\s+/g, " ");
    const fnIdx = src.indexOf("export async function getUserInfo");
    const fnBody = src.slice(fnIdx, src.indexOf("export function toSafeUser", fnIdx));
    // 不经 getUserUuid()（其 status 门会把待激活管理员挡在改密页外）
    expect(fnBody).not.toContain("getUserUuid()");
    expect(fnBody).toContain("session?.user?.uuid");
  });
});

describe("联盟奖励冲销（迁移 0028 静态断言，第十三批）", () => {
  const sql = () =>
    sourceOf("data/migrations/0028_affiliate_reward_reversal.sql").replace(/\s+/g, " ");

  it("0028 冲销 RPC 迁 private + REVOKE/GRANT 成对 + 幂等语义", () => {
    const src = sql();
    expect(src).toContain("CREATE OR REPLACE FUNCTION private.reverse_affiliate_reward");
    expect(src).toContain("REVOKE ALL ON FUNCTION private.reverse_affiliate_reward");
    expect(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION private\\.reverse_affiliate_reward\\([^)]*\\) TO service_role`
      ).test(src),
      "GRANT EXECUTE ... TO service_role for reverse_affiliate_reward"
    ).toBe(true);
    // 幂等三要素：FOR UPDATE 行锁 + 仅 completed 可冲销 + NOT FOUND 返回 0
    expect(src).toContain("FOR UPDATE");
    expect(src).toContain("status = 'completed'");
    expect(src).toContain("IF NOT FOUND THEN");
  });

  it("退款与拒付路径均接线冲销（services/refund + services/dispute）", () => {
    const refundSrc = sourceOf("services/refund.ts").replace(/\s+/g, " ");
    expect(refundSrc).toContain('"reverse_affiliate_reward"');
    // 退款路径的冲销在 serverClient().schema("private") 分段内（fundsRpcs 断言兜底）
    const disputeSrc = sourceOf("services/dispute.ts").replace(/\s+/g, " ");
    expect(disputeSrc).toContain('"reverse_affiliate_reward"');
    expect(disputeSrc).toContain('.schema("private")');
    // 冲销结果进埋点 detail，告警可追溯
    expect(refundSrc).toContain("reversed_affiliate_reward");
    expect(disputeSrc).toContain("reversed_affiliate_reward");
  });

  it("my-invites 页渲染 reversed 状态 + i18n 提供标签", () => {
    const src = sourceOf(
      "app/[locale]/(default)/(console)/my-invites/page.tsx"
    ).replace(/\s+/g, " ");
    expect(src).toContain('"reversed"');
    const en = sourceOf("i18n/messages/en.json");
    const zh = sourceOf("i18n/messages/zh.json");
    expect(en).toContain('"reversed"');
    expect(zh).toContain('"reversed"');
  });
});
