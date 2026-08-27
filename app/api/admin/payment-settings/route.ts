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
    const { settings = [], products = [] } = body || {};

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

    // 定价映射（M1 修复：与 /api/admin/payment-products 同规则 —— 金额/积分/有效期必须 > 0，
    // 否则可把商品金额改成 0 制造「免费送积分」的资损配置；复审 2：先 floor 再校验，
    // 防止 0.5 通过校验后被 floor 成 0）
    for (const prod of products) {
      const fields: Record<string, unknown> = {};
      if (typeof prod.amount === "number") {
        const amount = Math.floor(prod.amount);
        if (amount <= 0) return respErr("amount must be a positive integer");
        fields.amount = amount;
      }
      if (typeof prod.credits === "number") {
        const credits = Math.floor(prod.credits);
        if (credits <= 0) return respErr("credits must be a positive integer");
        fields.credits = credits;
      }
      if (typeof prod.valid_months === "number") {
        const valid_months = Math.floor(prod.valid_months);
        if (valid_months <= 0) return respErr("valid_months must be a positive integer");
        fields.valid_months = valid_months;
      }
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
      detail: JSON.stringify({ settings, products }),
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
