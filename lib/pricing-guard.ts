/**
 * 定价写入不变量（P0-定价-1 / P1-定价-1，docs/05 §5.1）
 *
 * `payment_products` 是运行时定价真相源，但它有**两个写入入口**
 * （/api/admin/payment-products 与 /api/admin/payment-settings 的 products 段）。
 * 两个入口必须走同一套校验，否则就形成旁路：被盗 admin session 可以经
 * payment-settings 写入「1 分卖 100 万积分」的套利定价（审查修复）。
 *
 * v1 单一 USD、一次性；金额/积分/有效期都受财务约束，不能只校验 >0。
 */

/** P1-定价-1 不变量上限（v1 单一 USD 包）。防御性上限，防止管理员/被盗 admin 把价设成天价或赠送积分。 */
export const MAX_PRODUCT_AMOUNT = 100_00_00; // 分，即 $10,000
export const MAX_PRODUCT_CREDITS = 1_000_000; // 100 万积分封顶
export const MAX_PRODUCT_VALID_MONTHS = 120; // 10 年

/**
 * 校验单个定价字段（调用方先 floor、再传入）：
 * 返回错误消息（null = 通过）。amount 与 credits 需成对校验比例下限。
 */
export function validatePricingFields(fields: {
  amount?: number;
  credits?: number;
  valid_months?: number;
}): string | null {
  if (typeof fields.amount === "number") {
    if (fields.amount <= 0) return "amount must be a positive integer";
    if (fields.amount > MAX_PRODUCT_AMOUNT) {
      return `amount must not exceed ${MAX_PRODUCT_AMOUNT}`;
    }
  }
  if (typeof fields.credits === "number") {
    if (fields.credits <= 0) return "credits must be a positive integer";
    if (fields.credits > MAX_PRODUCT_CREDITS) {
      return `credits must not exceed ${MAX_PRODUCT_CREDITS}`;
    }
  }
  if (typeof fields.valid_months === "number") {
    if (fields.valid_months <= 0) return "valid_months must be a positive integer";
    if (fields.valid_months > MAX_PRODUCT_VALID_MONTHS) {
      return `valid_months must not exceed ${MAX_PRODUCT_VALID_MONTHS}`;
    }
  }
  // 价格/积分比例下限：等积分 ≤ 金额（分）的有意义定价，杜绝「¥1 卖 10000 积分」的套利定价
  if (
    typeof fields.amount === "number" &&
    typeof fields.credits === "number" &&
    fields.credits > fields.amount
  ) {
    return "credits must not exceed amount (no giveaway pricing: 1 ¢ for many credits)";
  }
  return null;
}
