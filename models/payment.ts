import { getSupabaseClient } from "@/models/db";

/**
 * 支付配置模型（6.1，docs/payment/provider-abstraction.md §五）
 * payment_settings：渠道启用状态（热切换根基，配置数据库化）
 * payment_products：定价映射（兼容预建产品 Creem 与动态金额 Waffo/Stripe）
 */

export interface PaymentSetting {
  provider: string;
  enabled: boolean;
  priority: number;
}

export interface PaymentProduct {
  product_id: string;
  amount: number;
  currency: string;
  credits: number;
  valid_months: number;
  creem_product_id?: string | null;
  stripe_price_id?: string | null;
}

/** 读取全部渠道设置（provider -> setting 映射） */
export async function getPaymentSettings(): Promise<
  Record<string, PaymentSetting>
> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("payment_settings")
    .select("*");

  if (error) {
    console.error("[payment] getPaymentSettings failed:", error.message);
    return {};
  }

  const map: Record<string, PaymentSetting> = {};
  (data || []).forEach((row) => {
    map[row.provider] = {
      provider: row.provider,
      enabled: row.enabled,
      priority: row.priority,
    };
  });
  return map;
}

/** 读取定价映射（product_id -> 渠道产品 ID 等） */
export async function getPaymentProducts(): Promise<
  Record<string, PaymentProduct>
> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("payment_products").select("*");

  if (error) {
    console.error("[payment] getPaymentProducts failed:", error.message);
    return {};
  }

  const map: Record<string, PaymentProduct> = {};
  (data || []).forEach((row) => {
    map[row.product_id] = {
      product_id: row.product_id,
      amount: row.amount,
      currency: row.currency,
      credits: row.credits,
      valid_months: row.valid_months,
      creem_product_id: row.creem_product_id,
      stripe_price_id: row.stripe_price_id,
    };
  });
  return map;
}

/** 更新渠道启用状态（后台热切换用，6.1 / P1 后台） */
export async function updatePaymentSetting(
  provider: string,
  enabled: boolean
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("payment_settings")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("provider", provider);

  if (error) {
    throw error;
  }
}

/** 更新渠道：启用状态 + 优先级（后台 /admin/payment 热切换） */
export async function updatePaymentSettingDetail(
  provider: string,
  fields: Partial<Pick<PaymentSetting, "enabled" | "priority">>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("payment_settings")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("provider", provider);
  if (error) {
    throw error;
  }
}

/** 更新定价映射（金额/积分/有效期/渠道产品 ID 回填） */
export async function updatePaymentProduct(
  productId: string,
  fields: Partial<
    Pick<
      PaymentProduct,
      | "amount"
      | "credits"
      | "valid_months"
      | "creem_product_id"
      | "stripe_price_id"
    >
  >
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("payment_products")
    .update(fields)
    .eq("product_id", productId);
  if (error) {
    throw error;
  }
}
