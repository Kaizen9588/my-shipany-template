import { generateText } from "ai";
import { getClientIp } from "@/lib/ip";
import {
  InsufficientCreditsError,
  CreditsTransType,
  decreaseCredits,
  getUserCredits,
} from "@/services/credit";
import {
  estimateCredits,
  getModelPricing,
} from "@/data/model-pricing";
import { getModelProvider } from "@/lib/ai/registry";
import { getUserUuid } from "@/services/user";
import { rateLimit, rateLimitUser } from "@/lib/ratelimit";
import { TelemetryEvents, trackServer } from "@/lib/telemetry/server";
import {
  beginAiRequest,
  bodyFingerprint,
  findAiRequest,
  isValidRequestId,
  markAiRequestFailed,
  markAiRequestSucceeded,
} from "@/lib/ai-request";

/**
 * POST /api/v1/ai/generate —— AI 文本生成（核心收费闭环，docs/13 v1.5）
 *
 * 流程：鉴权 → 限流 → 参数校验 → 原子扣减（预估一次扣清）→ 幂等落账（running）
 *       → 模型路由 → 生成 → succeeded / failed（退款）
 * - 成功不退差额（用户付本次调用上限）；失败全额退款（ai_refund），
 *   退款失败落 refund_pending 由 cron 指数重试（崩溃补偿，迁移 0032）
 *
 * 幂等（Idempotency-Key 头，可选但强烈推荐）：
 * - 提供且合法（1~128 位 URL 安全字符）：按 (user_uuid, request_id) 幂等——
 *   同键同体在途/已成功返 409（带已有记录摘要），同键异体返 422，
 *   同键同体且上次 failed/refunded 可重跑；未提供则服务端生成键（不可重试）
 * - 提供但格式非法：400
 *
 * 请求：{ model, prompt | messages, max_tokens?, stream? }
 * 响应：200 {code:0, data:{text, reasoning?, usage, credits_charged}}
 *       401 未认证 / 402 余额不足 / 409 幂等冲突 / 422 同键异体 / 429 限流 / 500 服务错误
 */
export async function POST(req: Request) {
  try {
    // 1. 鉴权（session 或 sk- API Key）
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return jsonErr("no auth, please sign-in", 401);
    }

    // 2. 限流（6.18：IP 维度 + 用户分级日配额；Upstash 配置时跨实例共享）
    const ip = await getClientIp();
    const rl = await rateLimit(`ip:${ip}`);
    if (!rl.ok) {
      return jsonErr("too many requests", 429, {
        retry_after_seconds: rl.retryAfterSeconds,
      });
    }
    const userCredits = await getUserCredits(user_uuid);
    const quota = await rateLimitUser(user_uuid, userCredits.left_credits > 0);
    if (!quota.ok) {
      return jsonErr("daily quota exceeded", 429, {
        retry_after_seconds: quota.retryAfterSeconds,
      });
    }

    // 3. 参数校验
    let { model, prompt, messages, max_tokens, stream } = await req.json();
    if (!model || typeof model !== "string") {
      return jsonErr("invalid params: model is required", 400);
    }
    if (stream) {
      return jsonErr("streaming is not supported in v1", 501);
    }

    const pricing = getModelPricing(model);
    if (!pricing) {
      // 模型白名单：客户端不可传任意 model
      return jsonErr(`invalid model: ${model}`, 400);
    }

    // M3（对抗性测试）：max_tokens 服务端封顶 —— 此前未校验，负数被当 truthy 传入
    // （预估扣费可能退化为仅 1 积分，若渠道对非法 max_tokens 做 clamp 则形成计费绕过），
    // 超大值也无上限。只允许 [1, pricing.max_output_tokens]。
    const rawMaxTokens =
      typeof max_tokens === "number" && Number.isFinite(max_tokens)
        ? Math.floor(max_tokens)
        : pricing.max_output_tokens;
    const safeMaxTokens = Math.min(
      Math.max(rawMaxTokens, 1),
      pricing.max_output_tokens
    );

    const textPrompt =
      typeof prompt === "string" && prompt.trim() ? prompt.trim() : "";
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!textPrompt && !hasMessages) {
      return jsonErr("invalid params: prompt is required", 400);
    }

    // 4. 幂等键（P1，迁移 0032）：客户端 Idempotency-Key 或服务端生成
    const headerKey = req.headers.get("idempotency-key") || "";
    if (headerKey && !isValidRequestId(headerKey)) {
      return jsonErr(
        "invalid idempotency-key: use 1-128 url-safe chars",
        400
      );
    }
    const requestId = headerKey || `srv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // 5. 模型路由（provider 凭证缺失 → 服务错误）
    const provider = getModelProvider(pricing.provider);
    if (!provider) {
      return jsonErr(
        `provider credentials not configured: ${pricing.provider}`,
        500
      );
    }

    // 6. 预估一次扣清（原子：余额校验 + 扣减，P-1.2）
    // 2.9：messages 计入输入长度（此前传 messages 时输入 0 计费）
    const creditsCharged = estimateCredits(pricing, textPrompt, safeMaxTokens, messages);
    try {
      await decreaseCredits({
        user_uuid,
        trans_type: CreditsTransType.AiGenerate,
        credits: creditsCharged,
      });
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return jsonErr("insufficient credits", 402, {
          required: creditsCharged,
          balance: e.balance,
        });
      }
      throw e;
    }

    // 7. 幂等落账（扣费成功后建 running 行——行存在即代表已扣费，迁移 0032）
    const fingerprint = bodyFingerprint({
      model,
      prompt: textPrompt,
      messages: hasMessages ? messages : undefined,
      max_tokens: safeMaxTokens,
    });
    const { row, conflict_code, existing } = await beginAiRequest({
      request_id: requestId,
      user_uuid,
      model,
      provider: pricing.provider,
      estimated_credits: creditsCharged,
      fingerprint,
    });
    if (conflict_code === 422) {
      // 同键不同体：退掉本次扣费（幂等判定发生在扣费之后，不能吞用户的钱）
      await refundQuietly(user_uuid, creditsCharged, "idempotency body mismatch");
      return jsonErr(
        "idempotency key reused with a different request body",
        422,
        { request_id: requestId }
      );
    }
    if (conflict_code === 409) {
      // 同键在途/已成功：退掉本次扣费，返回已有记录状态
      await refundQuietly(user_uuid, creditsCharged, "idempotency duplicate");
      return jsonErr("request already in flight or completed", 409, {
        request_id: requestId,
        status: existing?.status,
        model: existing?.model,
        estimated_credits: existing?.estimated_credits,
        created_at: existing?.created_at,
      });
    }

    // 8. 生成
    try {
      const modelInstance = provider.createModel(model);
      const result = await generateText({
        model: modelInstance,
        ...(hasMessages
          ? { messages }
          : { prompt: textPrompt }),
        maxTokens: safeMaxTokens,
      });

      await markAiRequestSucceeded(row!.id, {
        input_tokens: result.usage?.promptTokens || 0,
        output_tokens: result.usage?.completionTokens || 0,
      });

      // 服务端真相源埋点（docs/13 §二步骤 7：扣减 + 生成成功后）
      trackServer({
        name: TelemetryEvents.AiGenerated,
        distinctId: user_uuid,
        properties: {
          model,
          credits_charged: creditsCharged,
          prompt_tokens: result.usage?.promptTokens || 0,
          completion_tokens: result.usage?.completionTokens || 0,
        },
      });

      return Response.json({
        code: 0,
        message: "ok",
        data: {
          request_id: requestId,
          text: result.text,
          ...(result.reasoning ? { reasoning: result.reasoning } : {}),
          usage: {
            prompt_tokens: result.usage?.promptTokens || 0,
            completion_tokens: result.usage?.completionTokens || 0,
          },
          credits_charged: creditsCharged,
        },
      });
    } catch (e) {
      // 服务端异常 / 模型报错 → 条件流转退款（failed / refund_pending），
      // 与崩溃补偿互斥；退款失败由 cron 指数重试（迁移 0032）
      console.error("[ai/generate] generate failed, refund:", creditsCharged, e);
      const outcome = await markAiRequestFailed(
        row!.id,
        user_uuid,
        creditsCharged,
        String((e as Error)?.message || e)
      );
      if (!outcome.refunded) {
        console.error(
          "[ai/generate] refund deferred to cron compensation, request_id=",
          requestId
        );
      }
      return jsonErr("ai generate failed", 500, {
        request_id: requestId,
        refund_status: outcome.status,
      });
    }
  } catch (e) {
    console.error("[ai/generate] failed:", e);
    return jsonErr("ai generate failed", 500);
  }
}

/** 幂等冲突路径的静默退款：退不掉只记日志（扣费刚成功，闪断概率极低；cron 不扫这类行——尚未落账） */
async function refundQuietly(user_uuid: string, credits: number, reason: string) {
  try {
    const { increaseCredits } = await import("@/services/credit");
    await increaseCredits({
      user_uuid,
      trans_type: CreditsTransType.AiRefund,
      credits,
      order_no: "",
    });
  } catch (e) {
    console.error(`[ai/generate] quiet refund failed (${reason}):`, e);
  }
}

/** 已成功记录读取（同键已成功时客户端可 GET 取回结果摘要） */
export async function GET(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return jsonErr("no auth, please sign-in", 401);
    }
    const requestId = new URL(req.url).searchParams.get("request_id") || "";
    if (!isValidRequestId(requestId)) {
      return jsonErr("invalid request_id", 400);
    }
    const row = await findAiRequest(user_uuid, requestId);
    if (!row) {
      return jsonErr("request not found", 404);
    }
    return Response.json({
      code: 0,
      message: "ok",
      data: {
        request_id: row.request_id,
        status: row.status,
        model: row.model,
        estimated_credits: row.estimated_credits,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        created_at: row.created_at,
        completed_at: row.completed_at,
      },
    });
  } catch (e) {
    console.error("[ai/generate] GET failed:", e);
    return jsonErr("query failed", 500);
  }
}

function jsonErr(message: string, status: number, data?: any) {
  return Response.json(
    {
      code: status === 200 ? 0 : -status,
      message,
      ...(data ? { data } : {}),
    },
    { status }
  );
}
