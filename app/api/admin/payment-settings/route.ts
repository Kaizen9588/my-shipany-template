import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { fireAndForgetAudit } from "@/lib/audit";
import {
  getPaymentProducts,
  getPaymentSettings,
  updatePaymentProduct,
  updatePaymentSettingDetail,
} from "@/models/payment";
import { getProviderHealthSnapshot } from "@/lib/payment/health";
import { aggregatePaymentEvents } from "@/lib/oplog";
import { parseReason } from "@/lib/admin-reason";
import { validatePricingFields } from "@/lib/pricing-guard";

/**
 * GET/PUT /api/admin/payment-settings
 * 后台支付渠道管理（6.1 + docs/16 §4.2b）：
 * - 渠道启用开关 / priority（热切换，无需重部署）
 * - payment_products 定价映射（金额/积分/有效期/渠道产品 ID）
 */
export async function GET() {
  try {
    const admin = await requireAdmin();
    const [settings, products, stats24h] = await Promise.all([
      getPaymentSettings(),
      getPaymentProducts(),
      aggregatePaymentEvents(24),
    ]);
    void admin;
    return respData({
      settings,
      products,
      health: getProviderHealthSnapshot(),
      stats24h,
    });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/payment-settings] GET failed:", e);
    return respErr("get payment settings failed");
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    const body = await req.json();
    const { settings = [], products = [], reason } = body || {};

    // N-6：渠道启停/优先级与定价映射都是资金路径配置，必须带理由
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`payment settings reason required: ${parsed.error}`);
    }

    // 渠道设置
    for (const s of settings) {
      const fields: { enabled?: boolean; priority?: number } = {};
      if (typeof s.enabled === "boolean") fields.enabled = s.enabled;
      if (typeof s.priority === "number" && s.priority >= 0) {
        fields.priority = Math.floor(s.priority);
      }
      if (Object.keys(fields).length > 0 && s.provider) {
        await updatePaymentSettingDetail(s.provider, fields);
      }
    }

    // 定价映射（与 /api/admin/payment-products 完全同规则 —— 这里是同一真相源的
    // 第二个写入入口，缺反套利校验就是旁路（1 分卖 100 万积分），审查修复：
    // 双入口共用 lib/pricing-guard；先 floor 再校验防 0.5 绕过）
    for (const prod of products) {
      const fields: Record<string, unknown> = {};
      const amount = typeof prod.amount === "number" ? Math.floor(prod.amount) : undefined;
      const credits = typeof prod.credits === "number" ? Math.floor(prod.credits) : undefined;
      const validMonths =
        typeof prod.valid_months === "number" ? Math.floor(prod.valid_months) : undefined;
      if (amount !== undefined || credits !== undefined || validMonths !== undefined) {
        const err = validatePricingFields({
          amount,
          credits,
          valid_months: validMonths,
        });
        if (err) return respErr(err);
      }
      if (amount !== undefined) fields.amount = amount;
      if (credits !== undefined) fields.credits = credits;
      if (validMonths !== undefined) fields.valid_months = validMonths;
      if (typeof prod.creem_product_id === "string") fields.creem_product_id = prod.creem_product_id;
      if (typeof prod.stripe_price_id === "string") fields.stripe_price_id = prod.stripe_price_id;
      if (typeof prod.waffo_product_id === "string") fields.waffo_product_id = prod.waffo_product_id;
      if (Object.keys(fields).length > 0 && prod.product_id) {
        await updatePaymentProduct(prod.product_id, fields);
      }
    }

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.payment_settings.update",
      target_type: "config",
      target_uuid: "",
      detail: JSON.stringify({ settings, products, reason: parsed.reason }),
    });

    return respData({ updated: true });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/payment-settings] PUT failed:", e);
    return respErr("update payment settings failed");
  }
}
