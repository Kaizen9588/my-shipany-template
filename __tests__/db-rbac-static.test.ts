import { readFileSync } from "fs";
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