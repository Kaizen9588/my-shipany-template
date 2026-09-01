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
];

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
    for (const rpc of fundsRpcs) {
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

function readFileSyncNames(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(".sql"));
}
