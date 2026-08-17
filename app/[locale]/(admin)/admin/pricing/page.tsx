import { requireAdmin } from "@/lib/auth";
import { getPaymentProducts } from "@/models/payment";
import PricingForm from "./pricing-form";

/**
 * 定价映射（6.1 / docs/16 §4.2b）
 * 与支付渠道管理分离：
 * - /admin/pricing 只管理 product_id → 金额/积分/有效月数/渠道产品 ID
 * - /admin/payment 只管理渠道启用开关 + 优先级 + 健康状态
 */
export default async function PricingAdminPage() {
  await requireAdmin();

  const productMap = await getPaymentProducts();
  const products = Object.values(productMap);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">定价映射</h3>
      <p className="text-sm text-muted-foreground">
        配置前台商品（product_id）对应的价格 / 积分 / 有效月数，以及各支付渠道
        （Creem / Stripe）的产品 ID。保存后即生效，Webhook 金额比对按这里的数据校验。
      </p>
      <PricingForm products={products} />
    </div>
  );
}
