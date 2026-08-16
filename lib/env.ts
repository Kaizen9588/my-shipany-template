import { z } from "zod";

/**
 * 环境变量校验（P-1.7）
 *
 * 启动时校验，缺失必填项直接 fail fast（由 instrumentation.ts 调用）。
 * 校验规则与 docs/08-config-env.md 保持一致（单一真相源）。
 */

const requiredSchema = z.object({
  NEXT_PUBLIC_WEB_URL: z.string().min(1, "NEXT_PUBLIC_WEB_URL is required"),
  NEXT_PUBLIC_PROJECT_NAME: z
    .string()
    .min(1, "NEXT_PUBLIC_PROJECT_NAME is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
});

const optionalSchema = z.object({
  // 数据库（缺省时仅 Landing Page 模式，不 fail fast）
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  // 鉴权
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  // 支付
  STRIPE_PUBLIC_KEY: z.string().optional(),
  STRIPE_PRIVATE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // 存储
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_DOMAIN: z.string().optional(),
  STORAGE_PREFIX: z.string().optional(),
  // AI
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  KLING_API_KEY: z.string().optional(),
  KLING_BASE_URL: z.string().optional(),
  // 其他
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: z.string().optional(),
  NEXT_PUBLIC_OPENPANEL_CLIENT_ID: z.string().optional(),
  SNOWFLAKE_WORKER_ID: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

export type EnvResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/** 校验环境变量，返回错误与警告列表（不抛异常，由调用方决定行为） */
export function validateEnv(): EnvResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredResult = requiredSchema.safeParse(process.env);
  if (!requiredResult.success) {
    requiredResult.error.issues.forEach((issue) => {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    });
  }

  const optionalResult = optionalSchema.safeParse(process.env);
  if (!optionalResult.success) {
    optionalResult.error.issues.forEach((issue) => {
      warnings.push(`${issue.path.join(".")}: ${issue.message}`);
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
