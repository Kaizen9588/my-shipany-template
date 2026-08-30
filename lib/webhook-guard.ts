/** Webhook 请求体大小上限（64KB，docs/boundary-spec N-5）——保护内存与日志/告警不被畸形请求打爆 */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

export interface WebhookGuardResult {
  ok: boolean;
  status?: number;
  reason?: string;
  /** 实测读出的 body（≤64KB）。chunked/无 content-length 的请求也在此拿到真实内容，
   *  调用方把它重建的 Request 传给 parseWebhook（Request.body 是只读 getter，审查修复）。 */
  rawBody?: string;
}

/**
 * Webhook 前置防护（N-5，docs/boundary-spec §Webhook body size）。
 *
 * 只做 body 上限（64KB）：防止超大/畸形请求打爆内存、触发日志/告警 DoS。
 * content-length 头只是快筛（诚实声明的大请求直接 413，不读流）；真正防线是
 * 流式实测——chunked / 谎报小值的 body 也会在读到 64KB+1 时被截断拒收。
 *
 * **刻意不对 webhook 端点做 IP 限流**：webhook 来源是支付渠道服务器而非用户，
 * 且默认 TRUSTED_PROXY=none 时 getClientIp 恒回 127.0.0.1（所有渠道共用一个桶）。
 * 对渠道限流会在高峰（买单潮）把真实支付事件拒回 429——漏收一次支付事件
 * 远严重于日志轰炸；渠道侧自办重试，本地只需在验签失败路径上克制告警频率。
 */
export async function guardWebhookRequest(
  req: Request
): Promise<WebhookGuardResult> {
  // 快筛：诚实声明的超大请求直接拒（省一次流式读取）
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > WEBHOOK_MAX_BODY_BYTES) {
    return { ok: false, status: 413, reason: "webhook body too large" };
  }

  // 流式实测：chunked / 谎报 content-length 的 body 在 64KB+1 处截断拒收
  const reader = req.body?.getReader();
  if (!reader) {
    return { ok: true, rawBody: "" }; // 无 body（GET/空请求）
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, status: 413, reason: "webhook body too large" };
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return { ok: true, rawBody: body };
}

/** 用实测 body 重建请求（Request.body 只读，且渠道验签需要原始 body 文本） */
export function requestWithRawBody(req: Request, rawBody: string): Request {
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  });
}
