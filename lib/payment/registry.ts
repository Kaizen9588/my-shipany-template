import { PaymentProvider } from "./types";
import { getPaymentSettings } from "@/models/payment";
import { isProviderHealthy } from "./health";

/**
 * 支付渠道注册表（6.1，docs/payment/provider-abstraction.md §3.3）
 *
 * 新增渠道：写一个 adapter + 这里加一行（阶段 2 加 Stripe/PayPal 时不动核心代码）。
 * 运行时启用状态来自数据库 payment_settings（热切换），不来自环境变量。
 */
const providers: Record<string, PaymentProvider> = {};

export function registerPaymentProvider(provider: PaymentProvider): void {
  providers[provider.id] = provider;
}

export function getPaymentProvider(id: string): PaymentProvider | undefined {
  return providers[id];
}

/** 所有已注册渠道（供 payment-methods 聚合） */
export function getAllPaymentProviders(): PaymentProvider[] {
  return Object.values(providers);
}

/**
 * 启用且凭据有效的渠道，按 payment_settings.priority 排序（小者优先 = 默认渠道）。
 * 渠道热切换：后台改 payment_settings 后无需重新部署即生效。
 * 6.1 阶段 3：健康检测不合格（连续失败被标记 unhealthy）的渠道跳过。
 */
export async function getEnabledProviders(): Promise<PaymentProvider[]> {
  const settings = await getPaymentSettings();

  return Object.entries(providers)
    .filter(([id, p]) => {
      const setting = settings[id];
      const enabled = !setting || setting.enabled;
      return enabled && p.hasValidCredentials() && isProviderHealthy(id);
    })
    .sort((a, b) => {
      const pa = settings[a[0]]?.priority ?? 100;
      const pb = settings[b[0]]?.priority ?? 100;
      return pa - pb;
    })
    .map(([, p]) => p);
}

/**
 * 按支付方式路由：取第一个启用、凭据有效、支持该方式的渠道。
 * 前端永远只传 method，不传 provider（渠道选择是服务端的事）。
 */
export async function routePaymentProvider(
  method?: string
): Promise<PaymentProvider | undefined> {
  const enabled = await getEnabledProviders();
  if (!method) {
    return enabled[0]; // 默认渠道
  }
  return enabled.find((p) => p.supported_methods.includes(method as any));
}
