/**
 * N-6：管理员高风险操作强制理由（docs/boundary-spec §N-6）
 *
 * 退款 / 调账 / 定价 / 渠道开关 / 密钥 / 角色与封禁变更，服务端必须收到非空 reason
 * 才执行；reason 原样进入 audit_logs.detail（操作为什么发生，事后可追责）。
 *
 * 审批流（双人复核 / 工单号）需要新表，归入后续迁移批次（见 handoff §5）。
 */

export const REASON_MAX_LEN = 200;

// 零宽/不可见字符：trim 不剥离、肉眼不可见，5 个 U+200B 就能绕过长度下限
// 把审计理由稀释成视觉空白（审查修复）。BOM/零宽空格/连接符/词连接符全清。
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g;

export interface ParsedReason {
  ok: boolean;
  reason: string;
  error?: string;
}

/**
 * 从请求体提取并校验 reason：
 * - 必填、剥离零宽字符后 trim，5~200 字符（太短的「1」「test」没有追责价值）
 * - 拒绝清洗后为空（纯零宽/空白）与超长
 */
export function parseReason(raw: unknown): ParsedReason {
  if (typeof raw !== "string") {
    return { ok: false, reason: "", error: "reason is required" };
  }
  const reason = raw.replace(INVISIBLE_RE, "").trim();
  if (reason.length < 5) {
    return {
      ok: false,
      reason: "",
      error: "reason must be at least 5 characters",
    };
  }
  if (reason.length > REASON_MAX_LEN) {
    return { ok: false, reason: "", error: "reason too long" };
  }
  return { ok: true, reason };
}
