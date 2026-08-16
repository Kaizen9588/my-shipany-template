import { generateText } from "ai";
import { getClientIp } from "@/lib/ip";
import {
  InsufficientCreditsError,
  CreditsTransType,
  decreaseCredits,
  getUserCredits,
  increaseCredits,
} from "@/services/credit";
import {
  estimateCredits,
  getModelPricing,
} from "@/data/model-pricing";
import { getModelProvider } from "@/lib/ai/registry";
import { getUserUuid } from "@/services/user";
import { rateLimit, rateLimitUser } from "@/lib/ratelimit";

/**
 * POST /api/v1/ai/generate —— AI 文本生成（核心收费闭环，docs/13）
 *
 * 流程：鉴权 → 限流 → 余额校验 → 原子扣减（预估一次扣清）→ 模型路由 → 生成
 * - 成功不退差额（用户付本次调用上限）
 * - 失败全额退款（ai_refund）
 *
 * 请求：{ model, prompt | messages, max_tokens?, stream? }
 * 响应：200 {code:0, data:{text, reasoning?, usage, credits_charged}}
 *       401 未认证 / 402 余额不足 / 429 限流 / 500 服务错误
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

    const textPrompt =
      typeof prompt === "string" && prompt.trim() ? prompt.trim() : "";
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!textPrompt && !hasMessages) {
      return jsonErr("invalid params: prompt is required", 400);
    }

    // 4. 模型路由（provider 凭证缺失 → 服务错误）
    const provider = getModelProvider(pricing.provider);
    if (!provider) {
      return jsonErr(
        `provider credentials not configured: ${pricing.provider}`,
        500
      );
    }

    // 5. 预估一次扣清（原子：余额校验 + 扣减，P-1.2）
    // 2.9：messages 计入输入长度（此前传 messages 时输入 0 计费）
    const creditsCharged = estimateCredits(pricing, textPrompt, max_tokens, messages);
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

    // 6. 生成
    try {
      const modelInstance = provider.createModel(model);
      const result = await generateText({
        model: modelInstance,
        ...(hasMessages
          ? { messages }
          : { prompt: textPrompt }),
        maxTokens: max_tokens || pricing.max_output_tokens,
      });

      return Response.json({
        code: 0,
        message: "ok",
        data: {
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
      // 服务端异常 / 模型报错 → 全额退款（用户付了钱没拿到服务）
      console.error("[ai/generate] generate failed, refund:", creditsCharged, e);
      try {
        await increaseCredits({
          user_uuid,
          trans_type: CreditsTransType.AiRefund,
          credits: creditsCharged,
          order_no: "",
        });
      } catch (refundErr) {
        console.error("[ai/generate] refund failed:", refundErr);
      }
      return jsonErr("ai generate failed", 500);
    }
  } catch (e) {
    console.error("[ai/generate] failed:", e);
    return jsonErr("ai generate failed", 500);
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
