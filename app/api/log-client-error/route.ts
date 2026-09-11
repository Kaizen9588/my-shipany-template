import {
  CLIENT_ERROR_BODY_LIMIT,
  createFingerprintThrottle,
  parseClientErrorPayload,
} from "@/lib/error-report";
import { getClientIp } from "@/lib/ip";
import { recordOpEvent } from "@/lib/oplog";
import { rateLimit } from "@/lib/ratelimit";

/**
 * POST /api/log-client-error —— 前端未捕获异常上报入口（docs/16 v2）
 *
 * 公开接口（匿名用户报错也要能到）：
 * - IP 限频（rateLimit，30/分）：防恶意刷接口
 * - 请求体 16KB 上限 + 字段类型/长度收口（parseClientErrorPayload）
 * - 指纹节流（单实例内存，60s/指纹）：同一错误风暴只落一条 op_event，
 *   同时约束告警外呼的量——事件本身进 op_events（/admin/logs 可查），
 *   warn 级走 outbox + notifyChannel（/admin/notify 可按事件开关）
 *
 * 响应纪律：任何内部异常一律 204，绝不回 5xx——客户端无法处理，
 * 5xx 只会诱发重试放大；噪音类错误（Script error 等）也按 204 静默吞掉。
 */

// 模块级单例：dev 热更/多 route 实例间各自计数可接受（节流是尽力而为的降噪）
const fingerprintThrottle = createFingerprintThrottle();

function silent(status: number): Response {
  return new Response(null, { status });
}

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rl = await rateLimit(`clienterr:ip:${ip}`, 30);
    if (!rl.ok) {
      return silent(429);
    }

    const text = await req.text();
    if (text.length > CLIENT_ERROR_BODY_LIMIT) {
      return silent(413);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return silent(400);
    }

    const parsed = parseClientErrorPayload(body);
    if (!parsed.ok) {
      return silent(parsed.reason === "unreportable" ? 204 : 400);
    }

    if (!fingerprintThrottle.allow(parsed.value.fingerprint)) {
      return silent(204);
    }

    recordOpEvent({
      event_type: "system.client_exception",
      severity: "warn",
      source: "app",
      detail: {
        message: parsed.value.message,
        kind: parsed.value.kind,
        url: parsed.value.url,
        stack: parsed.value.stack.slice(0, 1500),
        ua: (req.headers.get("user-agent") || "").slice(0, 300),
      },
    });

    return silent(204);
  } catch {
    return silent(204);
  }
}
