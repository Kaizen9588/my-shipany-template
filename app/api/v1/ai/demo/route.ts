import { generateText } from "ai";
import { getClientIp } from "@/lib/ip";
import { getSupabaseClient } from "@/models/db";
import { getModelPricing } from "@/data/model-pricing";
import { getModelProvider } from "@/lib/ai/registry";
import { hashString } from "@/lib/hash";
import { rateLimitByIp } from "@/lib/ratelimit";

/**
 * POST /api/v1/ai/demo —— 匿名 AI 演示（6.0.1，docs/14）
 *
 * 无需登录，服务端按 IP 每日限次。
 * 匿名额度 ≠ 积分：匿名是限流（服务端计数），登录才是积分账户。
 *
 * S3 收敛（2026-08 审查）：
 * - 模型由服务端决定（DEMO_MODEL 环境变量，默认 deepseek-chat），
 *   不接受客户端 model 参数——此前白名单内任意模型（含 gpt-4o）可被匿名免费调用
 * - 额度主维度为纯 IP：x-device-id 是客户端可任意伪造的头，作为额度键会被
 *   随机换值无限刷额度。IP 可信度由 lib/ip.ts 的 TRUSTED_PROXY 收敛保证
 *   （ NAT 共享出口会共享每日额度，演示场景可接受；代理池绕过是已知边界，docs/14）
 *
 * 请求体：{ prompt }
 * 响应：200 {code:0, data:{text, remaining}}
 *       429 今日免费次数已用完（提示登录送 10 积分）
 *       500 服务错误（失败退还次数）
 */
export async function POST(req: Request) {
  try {
    const ip = await getClientIp();

    // 简易限流兜底（防单 IP 高频打爆）
    const rl = rateLimitByIp(ip, 60);
    if (!rl.ok) {
      return jsonErr("too many requests", 429);
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return jsonErr("invalid params: prompt is required", 400);
    }

    // S3：演示模型由服务端决定，不开放客户端选择（也不开放昂贵模型）
    const demoModel = process.env.DEMO_MODEL || "deepseek-chat";
    const pricing = getModelPricing(demoModel);
    if (!pricing) {
      return jsonErr("demo model not configured", 500);
    }
    const maxTokens = parseInt(process.env.DEMO_MAX_TOKENS || "1024", 10) || 1024;

    // 匿名识别：纯 IP（x-device-id 可伪造，见头部注释）
    const anonymousKey = hashString(ip);
    const today = new Date().toISOString().slice(0, 10);
    const dailyLimit =
      parseInt(process.env.ANONYMOUS_DAILY_LIMIT || "3", 10) || 3;

    // 原子递增配额（RPC，达到上限后不再递增并返回 NULL，见 0016 迁移）
    const supabase = getSupabaseClient();
    const { data: count, error } = await supabase.rpc(
      "increment_anonymous_usage",
      {
        p_key: anonymousKey,
        p_date: today,
        p_limit: dailyLimit,
      }
    );
    if (error) {
      console.error("[ai/demo] increment usage failed:", error);
      return jsonErr("demo failed", 500);
    }

    // L2（对抗性测试）：RPC 返回 NULL 表示已达上限（不再递增），
    // 此前按 count >= dailyLimit 判断导致上限 3 时实际只放行 2 次（off-by-one）
    if (count === null || count > dailyLimit) {
      return jsonErr(
        "今日免费次数已用完，登录送 10 积分",
        429,
        { remaining: 0 }
      );
    }

    // 模型路由 + 生成
    try {
      const provider = getModelProvider(pricing.provider);
      if (!provider) {
        throw new Error(
          `provider credentials not configured: ${pricing.provider}`
        );
      }

      const result = await generateText({
        model: provider.createModel(demoModel),
        prompt: prompt.trim(),
        maxTokens,
      });

      return Response.json({
        code: 0,
        message: "ok",
        data: {
          text: result.text,
          ...(result.reasoning ? { reasoning: result.reasoning } : {}),
          remaining: Math.max(dailyLimit - count, 0),
        },
      });
    } catch (e) {
      // 服务端异常/模型报错 → 退还次数（用户未获得服务）
      console.error("[ai/demo] generate failed:", e);
      await supabase.rpc("decrement_anonymous_usage", {
        p_key: anonymousKey,
        p_date: today,
      });
      return jsonErr("demo failed", 500);
    }
  } catch (e) {
    console.error("[ai/demo] failed:", e);
    return jsonErr("demo failed", 500);
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
