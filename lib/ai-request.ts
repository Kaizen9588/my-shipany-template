import { createHash } from "crypto";
import { getIsoTimestr } from "@/lib/time";
import { serverClient } from "@/models/db";
import { CreditsTransType, increaseCredits } from "@/services/credit";
import type { Message } from "ai";

/**
 * AI 请求状态机（P1，迁移 0032，docs/13 v1.5 / docs/03 §P1）
 *
 * 行存在即代表已扣费（路由扣费成功后才建 running 行）——消除「扣费后崩溃
 * 已扣未记」的歧义；状态流转全部用 eq(status) 条件更新做并发互斥：
 * - running → succeeded / failed（生成成败，路由内完成）
 * - running → refunded（崩溃补偿：cron 扫 running 超 30 分钟）
 * - failed 尝试退款失败 → refund_pending → cron 重试 → refunded
 * - 幂等：UNIQUE(user_uuid, request_id)（P1-5 按用户隔离）+ 请求体指纹，
 *   同键同体重用已成功结果（409），同键异体 422，failed/refunded 可同键重跑
 * - TTL：completed 超 24h 的记录由每日 cron 清理（幂等键有效期口径）
 */

export type AiRequestStatus =
  | "created"
  | "running"
  | "succeeded"
  | "failed"
  | "refund_pending"
  | "refunded";

export interface AiRequestRow {
  id: number;
  request_id: string;
  user_uuid: string;
  model: string;
  provider: string;
  estimated_credits: number;
  body_fingerprint: string;
  status: AiRequestStatus;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string;
  refund_attempts: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Idempotency-Key 格式：1~128 位 URL 安全字符 */
const REQUEST_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

export function isValidRequestId(key: unknown): key is string {
  return typeof key === "string" && REQUEST_ID_RE.test(key);
}

/**
 * 请求体指纹：同键不同体返 422 的判据。
 * messages 数组按 JSON 序列化进指纹（同键必须承载完全相同的输入）。
 */
export function bodyFingerprint(input: {
  model: string;
  prompt?: string;
  messages?: Message[];
  max_tokens: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        model: input.model,
        prompt: input.prompt || "",
        messages: input.messages || [],
        max_tokens: input.max_tokens,
      })
    )
    .digest("hex");
}

function table() {
  return serverClient().from("ai_requests");
}

/**
 * 幂等落账 + 扣费预留：扣费成功（decreaseCredits）之后调用。
 * - 新键：INSERT running 行
 * - 同键命中：
 *   - 同指纹且行 succeeded → 返回已成功行（调用方 409，客户端可安全重试读取）
 *   - 同指纹且 running → 处理中（调用方 409）
 *   - 同指纹且 failed/refunded → 终态可重跑：条件更新置回 running（与崩溃补偿
 *     互斥——0 行命中说明补偿/重试正在跑，调用方 409）
 *   - 异指纹 → 422（调用方拒绝请求体）
 * @returns conflict_code：null=继续生成；409=幂等冲突；422=同键异体
 */
export async function beginAiRequest(input: {
  request_id: string;
  user_uuid: string;
  model: string;
  provider: string;
  estimated_credits: number;
  fingerprint: string;
}): Promise<{ row: AiRequestRow | null; conflict_code: number | null; existing?: AiRequestRow }> {
  const row = {
    request_id: input.request_id,
    user_uuid: input.user_uuid,
    model: input.model,
    provider: input.provider,
    estimated_credits: input.estimated_credits,
    body_fingerprint: input.fingerprint,
    status: "running" as const,
  };
  const { data, error } = await table().insert(row).select().maybeSingle();
  if (!error && data) {
    return { row: data as AiRequestRow, conflict_code: null };
  }
  // UNIQUE 冲突（23505）或其他错误 → 读已存在行判定
  const existing = await findAiRequest(input.user_uuid, input.request_id);
  if (!existing) {
    if (error) {
      throw new Error(`ai request insert failed: ${error.message}`);
    }
    throw new Error("ai request insert returned no row and no existing record");
  }
  if (existing.body_fingerprint !== input.fingerprint) {
    return { row: null, conflict_code: 422, existing };
  }
  if (existing.status === "succeeded" || existing.status === "running") {
    return { row: null, conflict_code: 409, existing };
  }
  // failed/refunded 终态可同键重跑：条件占用 running（与崩溃补偿互斥）
  const { data: claimed, error: claimErr } = await table()
    .update({ status: "running", error_message: "", updated_at: getIsoTimestr() })
    .eq("id", existing.id)
    .in("status", ["failed", "refunded"])
    .select()
    .maybeSingle();
  if (claimErr) {
    throw new Error(`ai request reclaim failed: ${claimErr.message}`);
  }
  if (!claimed) {
    // 0 行 = 补偿任务恰好也在改这行：当冲突处理，不重复扣费
    return { row: null, conflict_code: 409, existing };
  }
  return { row: claimed as AiRequestRow, conflict_code: null };
}

export async function findAiRequest(
  user_uuid: string,
  request_id: string
): Promise<AiRequestRow | null> {
  const { data, error } = await table()
    .select("*")
    .eq("user_uuid", user_uuid)
    .eq("request_id", request_id)
    .maybeSingle();
  if (error) {
    throw new Error(`ai request query failed: ${error.message}`);
  }
  return (data as AiRequestRow) || null;
}

/** 生成成功：条件流转 running→succeeded；0 行 = 行已被并发修改（记日志不抛错） */
export async function markAiRequestSucceeded(
  id: number,
  usage: { input_tokens?: number; output_tokens?: number } = {}
): Promise<void> {
  const { data, error } = await table()
    .update({
      status: "succeeded",
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      completed_at: getIsoTimestr(),
      updated_at: getIsoTimestr(),
    })
    .eq("id", id)
    .eq("status", "running")
    .select()
    .maybeSingle();
  if (error) {
    console.error("[ai-request] mark succeeded failed:", error.message);
  } else if (!data) {
    console.error("[ai-request] mark succeeded claimed 0 rows (concurrent mutation), id=", id);
  }
}

/**
 * 生成失败：退款 + 条件流转。返回实际状态（failed=退款成功 / refund_pending=退款失败）。
 * 条件更新与崩溃补偿互斥：0 行命中 = 补偿已处理，不重复退款。
 */
export async function markAiRequestFailed(
  id: number,
  user_uuid: string,
  credits: number,
  errorMessage: string
): Promise<{ status: AiRequestStatus; refunded: boolean }> {
  // 先条件占用（running→refund_pending 中间态，0 行 = 已被处理）
  const { data: claimed, error: claimErr } = await table()
    .update({ status: "refund_pending", error_message: String(errorMessage).slice(0, 500), updated_at: getIsoTimestr() })
    .eq("id", id)
    .eq("status", "running")
    .select()
    .maybeSingle();
  if (claimErr) {
    throw new Error(`ai request fail claim failed: ${claimErr.message}`);
  }
  if (!claimed) {
    return { status: "refunded", refunded: false };
  }
  const refunded = await refundAiRequest(claimed as AiRequestRow, user_uuid, credits);
  return { status: refunded ? "failed" : "refund_pending", refunded };
}

/** refund_pending 的 cron 重试入口：退款成功 → refunded 终态 */
export async function retryAiRequestRefund(
  row: AiRequestRow,
  credits: number
): Promise<boolean> {
  return refundAiRequest(row, row.user_uuid, credits);
}

/**
 * 退款 + 状态收口（refund_pending→failed / refunded）。
 * 退款失败：refund_attempts+1 留在 refund_pending 等 cron 重试。
 */
async function refundAiRequest(
  row: AiRequestRow,
  user_uuid: string,
  credits: number
): Promise<boolean> {
  const finalStatus = row.status === "running" ? "refunded" : "failed";
  try {
    await increaseCredits({
      user_uuid,
      trans_type: CreditsTransType.AiRefund,
      credits,
      order_no: "",
    });
  } catch (e) {
    console.error("[ai-request] refund failed:", e);
    // 留 refund_pending，refund_attempts+1，cron 指数重试
    await table()
      .update({
        refund_attempts: (row.refund_attempts || 0) + 1,
        error_message: `refund failed: ${String((e as Error)?.message || e).slice(0, 400)}`,
        updated_at: getIsoTimestr(),
      })
      .eq("id", row.id)
      .eq("status", "refund_pending");
    return false;
  }
  const { error } = await table()
    .update({
      status: finalStatus,
      completed_at: getIsoTimestr(),
      updated_at: getIsoTimestr(),
    })
    .eq("id", row.id)
    .eq("status", "refund_pending");
  if (error) {
    // 退款已成功但状态流转失败：不抛错（钱已退，下轮 cron 幂等收口会再扫到，
    // 而 refund 端 increaseCredits 无幂等键，重扫不会重复退——流转失败只会把
    // 行留成 refund_pending，需人工对账，error log 告知）
    console.error("[ai-request] final status update failed:", error.message);
  }
  return true;
}

/**
 * 崩溃补偿（每日/高频 cron，有界）：
 * 1. running 超 30 分钟 = 扣费后进程崩溃 → 条件占用 refund_pending → 退款 → refunded
 * 2. refund_pending 超 10 分钟 = 退款重试
 * @returns { scanned, compensated, refunded, still_pending }
 */
export async function compensateStaleAiRequests(
  limit = 20
): Promise<{
  scanned: number;
  compensated: number;
  refunded: number;
  still_pending: number;
}> {
  const staleRunningBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const stalePendingBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // 1. running 滞留（崩溃）
  const { data: staleRunning, error: runningErr } = await table()
    .select("*")
    .eq("status", "running")
    .lt("updated_at", staleRunningBefore)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (runningErr) {
    throw new Error(`ai recover running query failed: ${runningErr.message}`);
  }
  let compensated = 0;
  let refundedCount = 0;
  for (const raw of (staleRunning as AiRequestRow[]) || []) {
    // 条件占用防与「同键重跑」并发双退
    const { data: claimed, error } = await table()
      .update({ status: "refund_pending", updated_at: getIsoTimestr() })
      .eq("id", raw.id)
      .eq("status", "running")
      .select()
      .maybeSingle();
    if (error || !claimed) {
      continue;
    }
    compensated += 1;
    if (await refundAiRequest(claimed as AiRequestRow, raw.user_uuid, raw.estimated_credits)) {
      refundedCount += 1;
    }
  }

  // 2. refund_pending 重试
  const { data: pending, error: pendingErr } = await table()
    .select("*")
    .eq("status", "refund_pending")
    .lt("updated_at", stalePendingBefore)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pendingErr) {
    throw new Error(`ai recover pending query failed: ${pendingErr.message}`);
  }
  let stillPending = 0;
  for (const raw of (pending as AiRequestRow[]) || []) {
    if (await retryAiRequestRefund(raw, raw.estimated_credits)) {
      // refunded
    } else {
      stillPending += 1;
    }
  }

  return {
    scanned: ((staleRunning as AiRequestRow[]) || []).length + ((pending as AiRequestRow[]) || []).length,
    compensated,
    refunded: refundedCount,
    still_pending: stillPending,
  };
}

/** 幂等键 TTL：completed 超 24h 的 succeeded/failed/refunded 记录清理 */
export async function cleanupCompletedAiRequests(
  hours = 24
): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await table()
    .delete()
    .in("status", ["succeeded", "failed", "refunded"])
    .lt("completed_at", cutoff)
    .select();
  if (error) {
    throw new Error(`ai requests cleanup failed: ${error.message}`);
  }
  return ((data as unknown[]) || []).length;
}
