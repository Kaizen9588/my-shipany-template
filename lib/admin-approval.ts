import { serverClient } from "@/models/db";
import { hasAdminLevel } from "@/lib/auth";
import { trackCriticalEvent } from "@/lib/oplog";
import { parseReason } from "@/lib/admin-reason";
import { findUserByUuid, updateUserByAdmin } from "@/models/user";
import { adjustCreditsByAdmin } from "@/services/credit";
import { findOrderByOrderNo } from "@/models/order";
import { processRefund } from "@/services/refund";
import { getPaymentProvider } from "@/lib/payment";
import { validatePricingFields } from "@/lib/pricing-guard";
import type { User } from "@/types/user";

/**
 * 管理员审批队列（N-6 剩余：双人复核，迁移 0030）
 *
 * 高危后台操作（退款/调积分/改角色/封禁/支付渠道+定价）不再在原路由直接执行：
 * submitApproval() 落 private.admin_approvals 审批单，由另一位管理员在
 * /admin/approvals 批准后立即执行（approve→execute 原子，执行失败置 failed 可重试）。
 *
 * 双人复核核心不变量（服务端强制）：
 * - 批准人必须达到单据 required_level，且 approver_uuid <> requester_uuid；
 * - 存在其他活跃管理员时一律 pending 等待复核；单管理员部署（无其他活跃
 *   管理员）自动降级 approved 并留痕（approver_uuid=''），照常执行——
 *   流程与审计统一，部署不死锁。双人复核保护要求 >= 2 个活跃管理员。
 *
 * 执行并发防护：approve→execute 一步完成；重试 failed 单时用
 * 「executing + 5 分钟 stale 回收」条件更新占用，防止双执行。
 */

export type ApprovalAction =
  | "refund"
  | "adjust_credits"
  | "user_role"
  | "user_status"
  | "payment_settings";

export interface ApprovalRow {
  id: number;
  action: ApprovalAction;
  required_level: "admin" | "super_admin";
  target_type: string;
  target_uuid: string;
  payload: Record<string, unknown>;
  reason: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "executing"
    | "executed"
    | "failed"
    | "cancelled";
  requester_uuid: string;
  requester_email: string;
  approver_uuid: string;
  approver_email: string;
  approve_reason: string;
  exec_error: string;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  updated_at: string;
}

const ACTION_META: Record<
  ApprovalAction,
  { level: "admin" | "super_admin"; target_type: string }
> = {
  refund: { level: "admin", target_type: "order" },
  adjust_credits: { level: "admin", target_type: "user" },
  user_role: { level: "super_admin", target_type: "user" },
  user_status: { level: "admin", target_type: "user" },
  payment_settings: { level: "admin", target_type: "config" },
};

export function isApprovalAction(v: unknown): v is ApprovalAction {
  return typeof v === "string" && v in ACTION_META;
}

function table() {
  return serverClient().schema("private").from("admin_approvals");
}

/** 是否存在其他活跃管理员（双人复核可行性判断，规格见 0030 注释） */
export async function hasOtherActiveAdmin(excludeUuid: string): Promise<boolean> {
  const supabase = serverClient();
  const { data, error } = await supabase
    .from("users")
    .select("uuid", { count: "exact", head: true })
    .in("role", ["admin", "super_admin"])
    .eq("status", "active")
    .neq("uuid", excludeUuid)
    .limit(1);
  if (error) {
    // 判断失败按「无其他管理员」降级会弱化双人复核，宁可失败也不放行
    throw new Error(`check other admins failed: ${error.message}`);
  }
  return !!data && data.length > 0;
}

export interface SubmitApprovalInput {
  action: ApprovalAction;
  requester: Pick<User, "uuid" | "email">;
  reason: string;
  target_uuid?: string;
  payload?: Record<string, unknown>;
}

/** 组装审批单（各路由提交时调用）；reason 已由调用方过 parseReason */
export function buildApprovalRow(
  input: SubmitApprovalInput
): Omit<ApprovalRow, "id" | "created_at" | "updated_at"> & {
  status: "pending" | "approved";
} {
  const meta = ACTION_META[input.action];
  return {
    action: input.action,
    required_level: meta.level,
    target_type: meta.target_type,
    target_uuid: input.target_uuid || "",
    payload: input.payload || {},
    reason: input.reason,
    status: "pending",
    requester_uuid: input.requester.uuid || "",
    requester_email: input.requester.email || "",
    approver_uuid: "",
    approver_email: "",
    approve_reason: "",
    exec_error: "",
    decided_at: null,
    executed_at: null,
  };
}

/** 创建审批单；单管理员部署（无其他活跃管理员）自动降级 approved 留痕 */
export async function submitApproval(
  input: SubmitApprovalInput
): Promise<{ approval: ApprovalRow; single_admin: boolean }> {
  const singleAdmin = !(await hasOtherActiveAdmin(input.requester.uuid || ""));
  const row = buildApprovalRow(input);
  if (singleAdmin) {
    row.status = "approved";
    // 留痕：approver 为空 + 理由注明降级，审计可辨
    row.approve_reason = "single-admin mode: no other active admin to review";
    row.decided_at = new Date().toISOString();
  }
  const { data, error } = await table().insert(row).select().maybeSingle();
  if (error) {
    throw new Error(`create approval failed: ${error.message}`);
  }
  const approval = data as ApprovalRow;
  trackCriticalEvent({
    event_type: "admin.approval.submitted",
    severity: singleAdmin ? "warn" : "info",
    source: "app",
    subject_uuid: input.target_uuid || "",
    detail: {
      approval_id: approval?.id,
      action: input.action,
      requester: input.requester.email || input.requester.uuid,
      single_admin: singleAdmin,
    },
  });
  return { approval, single_admin: singleAdmin };
}

export async function getApprovalById(id: number): Promise<ApprovalRow | null> {
  const { data, error } = await table().select("*").eq("id", id).maybeSingle();
  if (error) {
    throw new Error(`get approval failed: ${error.message}`);
  }
  return (data as ApprovalRow) || null;
}

export async function listOpenApprovals(limit = 50): Promise<ApprovalRow[]> {
  const { data, error } = await table()
    .select("*")
    .in("status", ["pending", "approved", "failed"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`list approvals failed: ${error.message}`);
  }
  return (data as ApprovalRow[]) || [];
}

export async function listRecentApprovals(limit = 20): Promise<ApprovalRow[]> {
  const { data, error } = await table()
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`list approvals failed: ${error.message}`);
  }
  return (data as ApprovalRow[]) || [];
}

export interface DecideApprovalInput {
  id: number;
  approver: Pick<User, "uuid" | "email" | "role">;
  decision: "approve" | "reject";
  approve_reason?: string;
}

export interface DecideResult {
  executed: boolean;
  status: string;
  exec_error?: string;
}

/**
 * 批准/驳回 + 批准即执行（一条服务内完成，减少跨请求窗口）
 * - pending -> approve：占用 executing -> 执行 -> executed / failed
 * - failed  -> approve：重试（重新占用执行）
 * - pending -> reject：终态
 */
export async function decideApproval(
  input: DecideApprovalInput
): Promise<DecideResult> {
  const approval = await getApprovalById(input.id);
  if (!approval) {
    throw new Error("approval not found");
  }
  if (
    approval.status !== "pending" &&
    approval.status !== "failed"
  ) {
    throw new Error(`approval is ${approval.status}, not decidable`);
  }
  // 双人复核核心不变量：发起人不得批准/驳回自己的单据
  if (approval.requester_uuid && approval.requester_uuid === input.approver.uuid) {
    throw new Error("requester cannot review own approval");
  }
  if (!hasAdminLevel(input.approver, approval.required_level)) {
    throw new Error("insufficient level to review this approval");
  }

  if (input.decision === "reject") {
    const { error } = await table()
      .update({
        status: "rejected",
        approver_uuid: input.approver.uuid || "",
        approver_email: input.approver.email || "",
        approve_reason: (input.approve_reason || "").slice(0, 200),
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("status", approval.status);
    if (error) {
      throw new Error(`reject approval failed: ${error.message}`);
    }
    trackCriticalEvent({
      event_type: "admin.approval.rejected",
      severity: "info",
      source: "app",
      subject_uuid: approval.target_uuid,
      detail: {
        approval_id: input.id,
        action: approval.action,
        approver: input.approver.email || input.approver.uuid,
      },
    });
    return { executed: false, status: "rejected" };
  }

  // approve：条件更新占用（status 前置匹配防并发双批），失败即有人抢先
  const now = new Date().toISOString();
  const { data: claimed, error: claimErr } = await table()
    .update({
      status: "executing",
      approver_uuid: input.approver.uuid || "",
      approver_email: input.approver.email || "",
      approve_reason: (input.approve_reason || "").slice(0, 200),
      exec_error: "",
      decided_at: now,
      updated_at: now,
    })
    .eq("id", input.id)
    .in("status", ["pending", "failed"])
    .select();
  if (claimErr) {
    throw new Error(`approve approval failed: ${claimErr.message}`);
  }
  if (!claimed || claimed.length === 0) {
    throw new Error("approval was just decided by another reviewer");
  }

  return executeApproval(approval.id, input.approver);
}

/** 条件占用一条 failed/executing-stale 单（重试路径） */
async function claimForRetry(id: number): Promise<boolean> {
  const now = Date.now();
  const staleBefore = new Date(now - 5 * 60 * 1000).toISOString();
  const { data, error } = await table()
    .update({ status: "executing", updated_at: new Date(now).toISOString() })
    .eq("id", id)
    .in("status", ["failed"])
    .select();
  if (error) {
    throw new Error(`claim approval failed: ${error.message}`);
  }
  if (data && data.length > 0) {
    return true;
  }
  // failed 抢占失败：可能是 executing 崩溃残留，允许 stale 回收重占
  const { data: stale, error: staleErr } = await table()
    .update({ status: "executing", updated_at: new Date(now).toISOString() })
    .eq("id", id)
    .eq("status", "executing")
    .lt("updated_at", staleBefore)
    .select();
  if (staleErr) {
    throw new Error(`claim stale approval failed: ${staleErr.message}`);
  }
  return !!stale && stale.length > 0;
}

/** 执行审批单（approve 即执行 / failed 重试共用）；执行前置 status=executing */
export async function executeApproval(
  id: number,
  executor: Pick<User, "uuid" | "email">
): Promise<DecideResult> {
  const approval = await getApprovalById(id);
  if (!approval) {
    throw new Error("approval not found");
  }
  if (approval.status !== "executing") {
    throw new Error(`approval is ${approval.status}, not executable`);
  }

  let execError = "";
  try {
    await dispatchApprovalAction(approval);
  } catch (e: any) {
    execError = String(e?.message || e || "execute failed").slice(0, 500);
  }

  if (execError) {
    // 置 failed（可重试）；条件更新防与取消/并发操作竞态
    await table()
      .update({
        status: "failed",
        exec_error: execError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "executing");
    trackCriticalEvent({
      event_type: "admin.approval.exec_failed",
      severity: "error",
      source: "app",
      subject_uuid: approval.target_uuid,
      detail: { approval_id: id, action: approval.action, error: execError },
    });
    return { executed: false, status: "failed", exec_error: execError };
  }

  await table()
    .update({
      status: "executed",
      executed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      exec_error: "",
    })
    .eq("id", id)
    .eq("status", "executing");
  trackCriticalEvent({
    event_type: "admin.approval.executed",
    severity: "warn",
    source: "app",
    subject_uuid: approval.target_uuid,
    detail: {
      approval_id: id,
      action: approval.action,
      requester: approval.requester_email || approval.requester_uuid,
      approver: approval.approver_email || approval.approver_uuid,
      executor: executor.email || executor.uuid,
    },
  });
  return { executed: true, status: "executed" };
}

export async function cancelApproval(
  id: number,
  requester: Pick<User, "uuid">
): Promise<void> {
  const { error } = await table()
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .eq("requester_uuid", requester.uuid || "");
  if (error) {
    throw new Error(`cancel approval failed: ${error.message}`);
  }
}

/**
 * 按 action 分发执行（payload 为提交时快照，执行时重新校验关键前提：
 * 目标存在性/状态在各自 service 内兜底，这里只做参数形状与不变量重验）
 */
async function dispatchApprovalAction(approval: ApprovalRow): Promise<void> {
  const payload = (approval.payload || {}) as Record<string, any>;
  switch (approval.action) {
    case "refund": {
      const order_no = String(payload.order_no || approval.target_uuid || "");
      if (!order_no) throw new Error("missing order_no");
      const order = await findOrderByOrderNo(order_no);
      if (!order) throw new Error("order not found");
      // 闭合语义与原路由一致：refund_requested 只本地闭合不触达渠道
      if (order.status === "refund_requested") {
        await processRefund({
          order_no,
          amount: typeof payload.amount === "number" ? payload.amount : undefined,
          admin_uuid: approval.requester_uuid,
          reason: approval.reason,
        });
        return;
      }
      if (order.status !== "paid") {
        throw new Error(`order is not refundable: ${order.status}`);
      }
      const providerId = order.payment_provider || "stripe";
      const provider = getPaymentProvider(providerId);
      if (!provider) {
        throw new Error(`unknown payment provider: ${providerId}`);
      }
      if (!provider.capabilities.refund_api || !provider.refund) {
        // 无商户退款 API 的渠道不进审批队列（原路由已给手动指引），
        // 队列单到达这里说明状态漂移，显式失败
        throw new Error(
          `provider ${providerId} has no refund api; use manual dashboard flow`
        );
      }
      await provider.refund({ order_no, amount: payload.amount });
      await processRefund({
        order_no,
        amount: typeof payload.amount === "number" ? payload.amount : undefined,
        admin_uuid: approval.requester_uuid,
        reason: approval.reason,
      });
      return;
    }
    case "adjust_credits": {
      const user_uuid = String(payload.user_uuid || approval.target_uuid || "");
      const credits = Number(payload.credits);
      if (!user_uuid || !Number.isInteger(credits) || credits === 0) {
        throw new Error("invalid adjust_credits payload");
      }
      if (Math.abs(credits) > 1000000) {
        throw new Error("credits amount too large");
      }
      const target = await findUserByUuid(user_uuid);
      if (!target) throw new Error("user not found");
      await adjustCreditsByAdmin({ user_uuid, credits, remark: approval.reason });
      return;
    }
    case "user_role": {
      const user_uuid = String(payload.user_uuid || approval.target_uuid || "");
      const role = String(payload.role || "");
      const VALID_ROLES = ["user", "operator", "admin", "super_admin"];
      if (!user_uuid || !VALID_ROLES.includes(role)) {
        throw new Error("invalid user_role payload");
      }
      const target = await findUserByUuid(user_uuid);
      if (!target) throw new Error("user not found");
      if (target.role === "super_admin" && role !== "super_admin") {
        // 与原路由同规：super_admin 降级是更敏感操作，仅 super_admin 批准
        // （required_level 已是 super_admin，双保险）
        throw new Error("cannot demote super_admin via approval queue");
      }
      await updateUserByAdmin(user_uuid, { role } as any);
      return;
    }
    case "user_status": {
      const user_uuid = String(payload.user_uuid || approval.target_uuid || "");
      const status = String(payload.status || "");
      if (!user_uuid || !["active", "banned"].includes(status)) {
        throw new Error("invalid user_status payload");
      }
      const target = await findUserByUuid(user_uuid);
      if (!target) throw new Error("user not found");
      if (target.role === "super_admin") {
        throw new Error("cannot modify super_admin via approval queue");
      }
      await updateUserByAdmin(user_uuid, { status } as any);
      return;
    }
    case "payment_settings": {
      // payload 形如 { settings: [...], products: [...] }，与原路由 PUT body 同构
      const settings = Array.isArray(payload.settings) ? payload.settings : [];
      const products = Array.isArray(payload.products) ? payload.products : [];
      // 不变量重验（防提交后 payload 被改——快照由服务端写入，双保险）
      for (const prod of products) {
        const amount = typeof prod.amount === "number" ? Math.floor(prod.amount) : undefined;
        const credits = typeof prod.credits === "number" ? Math.floor(prod.credits) : undefined;
        const validMonths =
          typeof prod.valid_months === "number" ? Math.floor(prod.valid_months) : undefined;
        if (amount !== undefined || credits !== undefined || validMonths !== undefined) {
          const err = validatePricingFields({
            amount,
            credits,
            valid_months: validMonths,
          });
          if (err) throw new Error(err);
        }
      }
      // P0-定价-1 剩余（迁移 0033）：事务化批量写入——此前逐条 UPDATE 独立
      // autocommit，中途失败会把真相源留在半更新状态（amount 已改 credits 未改，
      // 积分≤金额不变量在中间态被打破 = 可套利定价）。RPC 内全量校验 + 原子写入，
      // 任一失败整体回滚。channel_id 缺省字段由 payload 原样透传（JSONB 保留形状）。
      const supabase = serverClient().schema("private");
      const { error: rpcError } = await supabase.rpc("apply_payment_config", {
        p_payload: { settings, products },
      });
      if (rpcError) {
        throw new Error(`apply_payment_config failed: ${rpcError.message}`);
      }
      return;
    }
    default:
      throw new Error(`unknown approval action: ${approval.action}`);
  }
}

export const _internal = {
  claimForRetry,
  ACTION_META,
  parseReason,
  /** 仅供单测：直接驱动执行分发器 */
  dispatchForTest: (approval: ApprovalRow) => dispatchApprovalAction(approval),
};
