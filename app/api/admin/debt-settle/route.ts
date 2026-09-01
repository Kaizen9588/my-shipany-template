import { NextResponse } from "next/server";

import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { serverClient } from "@/models/db";
import { parseReason } from "@/lib/admin-reason";
import { fireAndForgetAudit } from "@/lib/audit";

/**
 * POST /api/admin/debt-settle —— 债务清偿（P0-1 闭环最后一环，N-6 强制理由）
 *
 * 回收工作台「清偿」按钮调用：private.settle_credit_debt 幂等置 settled +
 * 用户无其他 outstanding 债务时账号 restricted→active。清偿方式写入
 * credit_debts.reason（数据库侧追加）与 audit_logs。
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin"); // 资金相关操作，需 admin 级
    const { debt_no, reason } = await req.json();

    if (!debt_no || typeof debt_no !== "string") {
      return respErr("invalid params");
    }
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`settle reason required: ${parsed.error}`);
    }

    // 资金操作走 service_role（serverClient），绕过 RLS（N-3）
    const supabase = serverClient().schema("private");
    const { data, error } = await supabase.rpc("settle_credit_debt", {
      p_debt_no: debt_no,
      p_note: parsed.reason,
    });
    if (error) {
      console.error("[admin/debt-settle] rpc failed:", error);
      return respErr("settle failed: " + error.message);
    }

    const settled = typeof data === "number" ? data : 0;
    if (settled === 0) {
      return respErr("debt already settled");
    }

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.credit_debt.settle",
      target_type: "credit_debt",
      target_uuid: debt_no,
      detail: JSON.stringify({
        due_credits: settled,
        reason: parsed.reason,
      }),
    });

    return respData({ settled: true, due_credits: settled });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/debt-settle] failed:", e);
    return respErr("settle failed: " + (e?.message || "unknown"));
  }
}
