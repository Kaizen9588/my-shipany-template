import { generateText } from "ai";
import { APICallError } from "@ai-sdk/provider";
import { getClientIp } from "@/lib/ip";
import { getSupabaseClient } from "@/models/db";
import { getModelPricing } from "@/data/model-pricing";
import { getModelProvider } from "@/lib/ai/registry";
import { hashString } from "@/lib/hash";
import { rateLimit } from "@/lib/ratelimit";

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
 * P0-4 收敛（2026-08-30，docs/14 §2.5）：「失败退还次数」+「输入无大小限制」
 * 曾构成单 IP 无限免费调用通道，现按文档四条修法落地：
 * 1. 扣次数之前做输入硬校验：字段白名单（仅 prompt）+ 字节上限（DEMO_MAX_PROMPT_BYTES，
 *    默认 8KB）；超限返回 413 且**照常消耗次数**，避免校验本身成为免费重试通道
 * 2. 退还仅限「已确认上游未产生费用」的错误（本地异常、provider 连接失败/5xx）；
 *    provider 4xx（含内容策略错误）一律计次
 * 3. 同一 IP 当日失败次数单独计数封顶（DEMO_FAILURE_DAILY_LIMIT，默认 10），
 *    达到上限当日拒绝；分钟级 IP 限流走统一 rateLimit（Upstash 缺失时内存兜底，
 *    两条路径都强制限流，不 fail-open）
 *
 * 请求体：{ prompt }（字段白名单，其余字段拒绝）
 * 响应：200 {code:0, data:{text, remaining}}
 *       413 prompt 超限（已消耗次数）
 *       429 今日免费次数已用完 / 失败次数达上限（提示登录送 10 积分）
 *       500 服务错误（仅无上游费用的错误退还次数）
 */
export async function POST(req: Request) {
  try {
    const ip = await getClientIp();

    // 分钟级 IP 限流（防单 IP 高频打爆；Upstash 配置时跨实例，缺失时内存兜底）
    const ratePerMin =
      parseInt(process.env.DEMO_RATELIMIT_PER_MIN || "30", 10) || 30;
    const rl = await rateLimit(`demo:${ip}`, ratePerMin);
    if (!rl.ok) {
      return jsonErr("too many requests", 429, {
        retry_after_seconds: rl.retryAfterSeconds,
      });
    }

    // 参数解析 + 字段白名单（400 不消耗次数：这类请求到不了模型，无成本风险）
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonErr("invalid params: json body required", 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonErr("invalid params: prompt is required", 400);
    }
    const fields = Object.keys(body as Record<string, unknown>);
    if (fields.some((k) => k !== "prompt")) {
      return jsonErr("invalid params: unexpected field", 400);
    }
    const { prompt } = body as { prompt?: unknown };
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
    const failCap =
      parseInt(process.env.DEMO_FAILURE_DAILY_LIMIT || "10", 10) || 10;
    const failKey = `fail:${anonymousKey}`;

    const maxPromptBytes =
      parseInt(process.env.DEMO_MAX_PROMPT_BYTES || "8192", 10) || 8192;
    const promptBytes = Buffer.byteLength(prompt, "utf8");

    const supabase = getSupabaseClient();

    const consumeDaily = async () => {
      // 原子递增配额（RPC，达到上限后不再递增并返回 NULL，见 0016 迁移）
      const { data, error } = await supabase.rpc("increment_anonymous_usage", {
        p_key: anonymousKey,
        p_date: today,
        p_limit: dailyLimit,
      });
      return { count: data as number | null, error };
    };

    // P0-4-1：输入硬限制（扣次数之前校验）；超限仍消耗次数，杜绝免费重试通道
    if (promptBytes > maxPromptBytes) {
      const { count, error } = await consumeDaily();
      if (error) {
        console.error("[ai/demo] increment usage failed:", error);
        return jsonErr("demo failed", 500);
      }
      if (count === null || count > dailyLimit) {
        return jsonErr("今日免费次数已用完，登录送 10 积分", 429, {
          remaining: 0,
        });
      }
      return jsonErr("prompt too large", 413, { max_prompt_bytes: maxPromptBytes });
    }

    // P0-4-3：同一 IP 当日失败次数封顶（读计数，不消耗次数）
    const { data: failRow } = await supabase
      .from("anonymous_usage")
      .select("count")
      .eq("anonymous_key", failKey)
      .eq("usage_date", today)
      .maybeSingle();
    const failCount = (failRow as { count?: number } | null)?.count ?? 0;
    if (failCount >= failCap) {
      return jsonErr("今日失败次数过多，请明天再试或登录使用", 429, {
        remaining: 0,
      });
    }

    // 原子递增配额
    const { count, error } = await consumeDaily();
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
      // P0-4-2/P0-4-3：失败先累计当日失败次数（达上限后 NULL，不再退还）；
      // 退还仅限「已确认上游未产生费用」的错误——本地异常、连接失败、provider 5xx。
      // provider 4xx（含内容策略拒绝）说明请求已到达上游，一律计次不退还。
      const isProvider4xx =
        APICallError.isInstance(e) &&
        typeof e.statusCode === "number" &&
        e.statusCode >= 400 &&
        e.statusCode < 500;
      console.error(
        `[ai/demo] generate failed (provider4xx=${isProvider4xx}):`,
        e
      );

      try {
        const { data: failedCount } = await supabase.rpc(
          "increment_anonymous_usage",
          { p_key: failKey, p_date: today, p_limit: failCap }
        );
        if (!isProvider4xx && failedCount !== null) {
          await supabase.rpc("decrement_anonymous_usage", {
            p_key: anonymousKey,
            p_date: today,
          });
        }
      } catch (failErr) {
        console.error("[ai/demo] record failure failed:", failErr);
      }

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
