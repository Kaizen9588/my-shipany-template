import { getSupabaseClient } from "@/models/db";
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
 * 与 logger/telemetry 同纪律：fire-and-forget、吞错、绝不阻塞业务主流程。
 * 落库经 runAfterResponse 调度（serverless 冻结安全）。
 *
 * 注意：Supabase insert 是异步的，这里显式吞掉异常，调用方无需 await。
 */
export function recordOpEvent(input: OpEventInput): void {
  runAfterResponse(async () => {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("op_events").insert({
        event_type: input.event_type,
        severity: input.severity || "info",
        source: input.source || "app",
        subject_uuid: input.subject_uuid || "",
        detail: input.detail || {},
      });
      if (error) {
        console.error("[oplog] record failed:", error.message);
      }
    } catch (e) {
      console.error("[oplog] record failed:", e);
    }
  });
}

/** fire-and-forget 写法（不需要 await 时用） */
export function fireAndForgetOpEvent(input: OpEventInput): void {
  recordOpEvent(input);
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

/** 关键事件三连：落库 + 服务端埋点 + 机器人告警（均经 after() 调度，冻结安全） */
export function trackCriticalEvent(input: OpEventInput): void {
  recordOpEvent(input);
  const severity = input.severity || "warn";
  if (severity === "critical" || severity === "warn" || severity === "error") {
    runAfterResponse(() =>
      // 动态 import 也可能失败（chunk 加载失败/构建回滚），不加 catch 会变成
      // unhandled rejection——告警丢就丢了，但不能因此炸掉 after() 链路
      import("@/lib/notify")
        .then(({ notifyChannel }) =>
          notifyChannel({
            title: `[${input.event_type}] ${input.subject_uuid || ""}`,
            body: `事件：\`${input.event_type}\`\n`
              + `级别：\`${severity}\`\n`
              + (input.subject_uuid ? `关联对象：${input.subject_uuid}\n` : "")
              + `详情：\`\`\`json\n${JSON.stringify(input.detail || {}, null, 2)}\n\`\`\``,
            severity,
            subject: input.subject_uuid || input.event_type,
            eventType: input.event_type,
          })
        )
        .catch((e) => {
          console.error("[oplog] notify import/dispatch failed:", e);
        })
    );
  }
}
