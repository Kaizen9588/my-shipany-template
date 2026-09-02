import { getSupabaseClient, serverClient } from "@/models/db";
import { runAfterResponse } from "@/lib/after-response";

export type OpSeverity = "info" | "warn" | "error" | "critical";

export interface OpEventInput {
  event_type: string;
  severity?: OpSeverity;
  source?: "app" | "webhook" | "cron" | "migration";
  subject_uuid?: string;
  detail?: Record<string, unknown>;
}

export interface OpEventRow extends OpEventInput {
  id: number | string;
  ip?: string | null;
  created_at: string;
}

/**
 * 运营事件落库（docs/16 §3.3）
 *
 * N-4 Transactional Outbox（迁移 0029）：
 * - info 级（非关键）：维持直插 + 吞错，丢失可接受（docs/16：非关键事件可 fire-and-forget）
 * - warn/error/critical（关键审计/资金/安全事件）：先入 private.op_event_outbox
 *   队列（一条 INSERT，失败退回直插），入队成功即视为已持久化——后续由
 *   dispatchOutbox()（本轮内联 + 后续事件顺带）与每日 cron（/api/cron/daily）
 *   从队列幂等投递到 op_events（FOR UPDATE SKIP LOCKED 领取 + ON CONFLICT 落库 +
 *   指数退避重试 + 超限 dead 死信）。投递失败不丢事件，只积压重试。
 *
 * 与业务同一语义纪律：不阻塞调用方主流程；与日志不同，关键事件不允许丢失。
 *
 * 注意：Supabase insert 是异步的，这里显式吞掉异常，调用方无需 await。
 */

const OUTBOX_SEVERITIES: OpSeverity[] = ["warn", "error", "critical"];

function isOutboxEvent(severity: OpSeverity): boolean {
  return OUTBOX_SEVERITIES.includes(severity);
}

function clientForInsert() {
  // 与 op_events 读路径一致的历史入口：配置了 service key 时升级为
  // service_role，仅 anon（公开只读审计面板场景）也保持原语义
  return getSupabaseClient();
}

/** 直插 op_events（info 级路径 / outbox 不可用时的退路），吞错返回是否成功 */
async function insertOpEvent(input: OpEventInput): Promise<boolean> {
  try {
    const supabase = clientForInsert();
    const { error } = await supabase.from("op_events").insert({
      event_type: input.event_type,
      severity: input.severity || "info",
      source: input.source || "app",
      subject_uuid: input.subject_uuid || "",
      detail: input.detail || {},
    });
    if (error) {
      console.error("[oplog] record failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[oplog] record failed:", e);
    return false;
  }
}

export function recordOpEvent(input: OpEventInput): void {
  const severity = input.severity || "info";
  if (!isOutboxEvent(severity)) {
    runAfterResponse(() => insertOpEvent(input));
    return;
  }

  // 关键事件：同步入队（不 await，失败退回直插；此后告警只在持久化成功后发）
  void enqueueOutboxEvent(input, severity);
}

/** 关键事件入 outbox 队列；入队成功后调度一次投递并外呼告警 */
async function enqueueOutboxEvent(
  input: OpEventInput,
  severity: OpSeverity
): Promise<void> {
  let queued = false;
  try {
    const supabase = serverClient();
    const { error } = await supabase.rpc("op_event_outbox_enqueue", {
      p_event_type: input.event_type,
      p_severity: severity,
      p_source: input.source || "app",
      p_subject_uuid: input.subject_uuid || "",
      p_detail: input.detail || {},
    });
    queued = !error;
    if (error) {
      console.error("[oplog] outbox enqueue failed:", error.message);
    }
  } catch (e) {
    console.error("[oplog] outbox enqueue failed:", e);
  }

  if (queued) {
    // 入队成功：本轮顺带投递一次（通常立即落库）；投递失败留给 cron 重试
    runAfterResponse(() => dispatchOutboxEvents());
    await notifyOpEvent(input, severity);
  } else {
    // 入队失败（库不可达等）：退回旧直插路径，尽力而为不丢主流程
    runAfterResponse(async () => {
      const ok = await insertOpEvent(input);
      if (ok) {
        await notifyOpEvent(input, severity);
      } else {
        // 连直插都失败：最后一次尝试经 after() 平台窗口外呼告警（人先知道）
        await notifyOpEvent(input, severity);
      }
    });
  }
}

/** 告警外呼（飞书/企微）：落库有保障后再发，渠道失败只丢告警不丢事件 */
async function notifyOpEvent(input: OpEventInput, severity: OpSeverity): Promise<void> {
  if (severity !== "critical" && severity !== "warn" && severity !== "error") {
    return;
  }
  try {
    // 动态 import 也可能失败（chunk 加载失败/构建回滚），不加 catch 会变成
    // unhandled rejection——告警丢就丢了，但不能因此炸掉 after() 链路
    const { notifyChannel } = await import("@/lib/notify");
    await notifyChannel({
      title: `[${input.event_type}] ${input.subject_uuid || ""}`,
      body: `事件：\`${input.event_type}\`\n`
        + `级别：\`${severity}\`\n`
        + (input.subject_uuid ? `关联对象：${input.subject_uuid}\n` : "")
        + `详情：\`\`\`json\n${JSON.stringify(input.detail || {}, null, 2)}\n\`\`\``,
      severity,
      subject: input.subject_uuid || input.event_type,
      eventType: input.event_type,
    });
  } catch (e) {
    console.error("[oplog] notify import/dispatch failed:", e);
  }
}

/**
 * outbox 投递（队列消费者）：领取一批 → 幂等落库 op_events → ack/退避重试。
 * 三个触发面：关键事件入队后内联一次；后续 trackCriticalEvent 调用顺带清积压；
 * 每日 cron /api/cron/daily 全量兜底。幂等：deliver ON CONFLICT DO NOTHING。
 */
export async function dispatchOutboxEvents(batchSize = 20): Promise<{
  delivered: number;
  deduped: number;
  failed: number;
}> {
  let delivered = 0;
  let deduped = 0;
  let failed = 0;
  try {
    const supabase = serverClient().schema("private");
    const { data, error } = await supabase.rpc("op_event_outbox_claim", {
      p_batch_size: batchSize,
    });
    if (error) {
      console.error("[oplog] outbox claim failed:", error.message);
      return { delivered, deduped, failed };
    }
    for (const row of (data || []) as Array<{
      id: number;
      event_id: string;
      event_type: string;
      severity: string;
      source: string;
      subject_uuid: string;
      detail: unknown;
      attempts: number;
    }>) {
      try {
        const { data: inserted, error: deliverErr } = await supabase.rpc(
          "op_event_deliver",
          {
            p_event_id: row.event_id,
            p_event_type: row.event_type,
            p_severity: row.severity,
            p_source: row.source,
            p_subject_uuid: row.subject_uuid,
            p_detail: row.detail ?? {},
          }
        );
        if (deliverErr) {
          throw deliverErr;
        }
        if (inserted) {
          delivered += 1;
        } else {
          deduped += 1; // 幂等命中：此前重试已落库
        }
        await supabase.rpc("op_event_outbox_ack", { p_id: row.id });
      } catch (e: any) {
        failed += 1;
        try {
          await supabase.rpc("op_event_outbox_fail", {
            p_id: row.id,
            p_error: String(e?.message || e),
          });
        } catch {
          // fail 自身失败（连接断开）：行仍处 processing，stale 回收会再领
        }
      }
    }
  } catch (e) {
    console.error("[oplog] outbox dispatch failed:", e);
  }
  return { delivered, deduped, failed };
}

/** 每日 cron 兜底：投递积压 + 清理 dead 死信行 */
export async function outboxMaintenance(): Promise<{
  delivered: number;
  deduped: number;
  failed: number;
  cleaned_dead: number;
}> {
  const result = await dispatchOutboxEvents(100);
  let cleaned_dead = 0;
  try {
    const { data, error } = await serverClient()
      .schema("private")
      .rpc("op_event_outbox_cleanup", { p_retain_days: 30 });
    if (error) {
      console.error("[oplog] outbox cleanup failed:", error.message);
    } else {
      cleaned_dead = typeof data === "number" ? data : 0;
    }
  } catch (e) {
    console.error("[oplog] outbox cleanup failed:", e);
  }
  return { ...result, cleaned_dead };
}

/** 检索运营事件（后台 /admin/logs） */
export async function queryOpEvents(params: {
  event_type?: string;
  severity?: string;
  subject?: string;
  page?: number;
  limit?: number;
}): Promise<{ rows: OpEventRow[]; total: number }> {
  const supabase = getSupabaseClient();
  const page = Math.max(parseInt(String(params.page || "1"), 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(String(params.limit || "50"), 10) || 50, 1),
    200
  );
  const start = (page - 1) * limit;

  let query = supabase.from("op_events").select("id,event_type,severity,source,subject_uuid,detail,ip,created_at", {
    count: "exact",
  });
  if (params.event_type) query = query.eq("event_type", params.event_type);
  if (params.severity) query = query.eq("severity", params.severity);
  if (params.subject) query = query.ilike("subject_uuid", `%${params.subject}%`);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(start, start + limit - 1);

  if (error) {
    console.error("[oplog] query failed:", error.message);
    return { rows: [], total: 0 };
  }
  return {
    rows: (data || []) as OpEventRow[],
    total: count || 0,
  };
}

/** 支付渠道 24h 成败统计（后台 /admin/payment 健康卡片） */
export async function aggregatePaymentEvents(
  hours = 24
): Promise<Record<string, { success: number; failed: number }>> {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from("op_events")
    .select("event_type, detail, severity")
    .gte("created_at", since);
  if (error) {
    console.error("[oplog] aggregate failed:", error.message);
    return {};
  }

  const result: Record<string, { success: number; failed: number }> = {};
  (data || []).forEach((row: any) => {
    const provider = row.detail?.provider as string | undefined;
    if (!provider) return;
    result[provider] ||= { success: 0, failed: 0 };
    if (row.event_type === "payment.provider_success") {
      result[provider].success += 1;
    } else if (row.event_type === "payment.provider_failure") {
      result[provider].failed += 1;
    }
  });
  return result;
}

/** fire-and-forget 写法（不需要 await 时用） */
export function fireAndForgetOpEvent(input: OpEventInput): void {
  recordOpEvent(input);
}

/** 关键事件三连：持久化（outbox）+ 服务端埋点 + 机器人告警（均经 after() 调度） */
export function trackCriticalEvent(input: OpEventInput): void {
  recordOpEvent(input);
}
