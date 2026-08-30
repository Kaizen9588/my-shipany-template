import { respData, respErr } from "@/lib/resp";
import { requireAdmin } from "@/lib/auth";
import { fireAndForgetAudit } from "@/lib/audit";
import {
  getPaymentProducts,
  updatePaymentProduct,
} from "@/models/payment";
import { parseReason } from "@/lib/admin-reason";
import { validatePricingFields } from "@/lib/pricing-guard";

/**
 * GET/PUT /api/admin/payment-products
 * 后台「定价映射」专用路由：只有 product_id → 金额/积分/有效期/渠道产品 ID
 * （支付渠道启用/优先级在 /api/admin/payment-settings）
 */
export async function GET() {
  try {
    await requireAdmin();
    const products = await getPaymentProducts();
    return respData({ products: Object.values(products) });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/payment-products] GET failed:", e);
    return respErr("get payment products failed");
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("admin");
    const body = await req.json();
    const { products = [], reason } = body || {};

    // N-6：定价写入落在收款金额权威源（P0-定价-1），必须带理由
    const parsed = parseReason(reason);
    if (!parsed.ok) {
      return respErr(`pricing update reason required: ${parsed.error}`);
    }

    // P0-定价-1：`payment_products` 是运行时定价真相源，写入必须过不变量校验
    // （与 /api/admin/payment-settings 共用 lib/pricing-guard，双入口同规则）。
    for (const prod of products) {
      if (!prod?.product_id) {
        continue;
      }
      const fields: Record<string, unknown> = {};
      // 复审 2：先 floor 再校验 —— 此前 0.5 可通过「>0 校验」后被 floor 成 0，
      // 落库 0 元/0 积分行（资损面）。消费侧 getCheckoutProduct 不再二次断言。
      const amount = typeof prod.amount === "number" ? Math.floor(prod.amount) : undefined;
      const credits = typeof prod.credits === "number" ? Math.floor(prod.credits) : undefined;
      const validMonths =
        typeof prod.valid_months === "number" ? Math.floor(prod.valid_months) : undefined;
      if (
        amount !== undefined ||
        credits !== undefined ||
        validMonths !== undefined
      ) {
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
      if (prod.currency && prod.currency !== "USD") {
        return respErr("v1 only supports USD currency");
      }
      if (typeof prod.creem_product_id === "string") fields.creem_product_id = prod.creem_product_id;
      if (typeof prod.stripe_price_id === "string") fields.stripe_price_id = prod.stripe_price_id;
      if (typeof prod.waffo_product_id === "string") fields.waffo_product_id = prod.waffo_product_id;
      if (Object.keys(fields).length > 0) {
        await updatePaymentProduct(prod.product_id, fields);
      }
    }

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.payment_products.update",
      target_type: "config",
      target_uuid: "",
      detail: JSON.stringify({
        productIds: products.map((p: any) => p?.product_id),
        reason: parsed.reason,
      }),
    });

    return respData({ updated: true });
  } catch (e: any) {
    if (e.message === "no admin access") {
      return respErr("no admin access", 403);
    }
    console.error("[admin/payment-products] PUT failed:", e);
    return respErr("update payment products failed");
  }
}
