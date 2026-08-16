/**
 * 服务端定价常量表（P-1.1 定价架构修复）
 *
 * 这是价格的**单一真相源**：Checkout API 只信任这里的金额/积分/有效期，
 * 客户端（i18n JSON / 前端组件）传入的 amount/credits/currency/valid_months 一律忽略。
 *
 * v1 明确单一 USD 一次性价，多币种/地区定价不做（MoR 渠道的全球定价能力
 * 留作后续产品决策，见 docs/12 遗留项跟踪表 2.5）。
 */
export interface PricingProduct {
  /** 产品 ID，如 'starter' / 'standard' / 'premium' */
  product_id: string;
  product_name: string;
  /** 金额（分，USD） */
  amount: number;
  currency: string;
  /** 充值积分 */
  credits: number;
  /** 积分有效期（月） */
  valid_months: number;
  /** v1 仅一次性，订阅不启用（见 DEVELOPMENT_PLAN 5.3） */
  interval: "one-time";
}

export const PRICING_PRODUCTS: PricingProduct[] = [
  {
    product_id: "starter",
    product_name: "ShipAny Boilerplate Starter",
    amount: 9900,
    currency: "USD",
    credits: 100,
    valid_months: 1,
    interval: "one-time",
  },
  {
    product_id: "standard",
    product_name: "ShipAny Boilerplate Standard",
    amount: 19900,
    currency: "USD",
    credits: 200,
    valid_months: 3,
    interval: "one-time",
  },
  {
    product_id: "premium",
    product_name: "ShipAny Boilerplate Premium",
    amount: 29900,
    currency: "USD",
    credits: 300,
    valid_months: 12,
    interval: "one-time",
  },
];

export function getPricingProduct(
  product_id: string
): PricingProduct | undefined {
  return PRICING_PRODUCTS.find((p) => p.product_id === product_id);
}
