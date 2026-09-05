"use client";

import { Check, Loader } from "lucide-react";
import { PricingItem, Pricing as PricingType } from "@/types/blocks/pricing";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Icon from "@/components/icon";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAppContext } from "@/contexts/app";
import { TelemetryEvents, track } from "@/lib/telemetry";

export default function Pricing({
  pricing,
  compact = false,
}: {
  pricing: PricingType;
  /** 弹框内嵌模式：去掉区块级大间距（py-16/mb-12），卡片纵向排列填满弹框 */
  compact?: boolean;
}) {
  const { user, setShowSignModal } = useAppContext();

  const [group, setGroup] = useState(pricing.groups?.[0]?.name);
  const [isLoading, setIsLoading] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  // 当前选中的套餐卡片：点击卡片切换高亮；
  // 默认选中 is_featured 的推荐套餐（无则第一个），与原有突出效果衔接
  const [selectedId, setSelectedId] = useState<string | null>(
    pricing.items?.find((item) => item.is_featured)?.product_id ??
      pricing.items?.[0]?.product_id ??
      null
  );

  useEffect(() => {
    if (pricing.items) {
      setGroup(pricing.items[0].group);
      setProductId(pricing.items[0].product_id);
      setIsLoading(false);

      // 6.5：进入定价区埋点
      track({ name: TelemetryEvents.PricingViewed });
    }
  }, [pricing.items]);

  if (pricing.disabled) {
    return null;
  }

  const handleCheckout = async (item: PricingItem) => {
    try {
      if (!user) {
        setShowSignModal(true);
        return;
      }

      // 6.5：支付漏斗埋点 t1 + 套餐选中
      track({
        name: TelemetryEvents.PlanSelected,
        properties: { plan: item.product_id },
      });
      track({
        name: TelemetryEvents.CheckoutStarted,
        properties: { plan: item.product_id },
      });

      // P-1.1：客户端只传 product_id，金额/积分/币种由服务端定价表决定
      const params = {
        product_id: item.product_id,
        interval: item.interval,
      };

      setIsLoading(true);
      setProductId(item.product_id);

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      if (response.status === 401) {
        setIsLoading(false);
        setProductId(null);

        setShowSignModal(true);
        return;
      }

      const { code, message, data } = await response.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }

      const { checkout_url } = data;
      if (!checkout_url) {
        toast.error("checkout failed");
        return;
      }

      // 6.5：支付漏斗埋点 t2（拿到托管页 URL，停留时长 = t3 - t2 间接计算）
      track({
        name: TelemetryEvents.CheckoutUrlRedirected,
        properties: { plan: item.product_id },
      });

      // 6.1：多渠道统一跳转（stripe/creem/waffo 都是 checkout_url，渠道对前端透明）
      window.location.href = checkout_url;
    } catch (e) {
      console.log("checkout failed: ", e);

      toast.error("checkout failed");
    } finally {
      setIsLoading(false);
      setProductId(null);
    }
  };

  return (
    <section
      id={pricing.name}
      className={compact ? "py-0" : "py-16"}
    >
      <div className={compact ? "" : "container"}>
        <div
          className={
            compact
              ? "mb-6 text-center"
              : "mx-auto mb-12 text-center"
          }
        >
          <h2 className={compact ? "mb-2 text-2xl font-semibold" : "mb-4 text-4xl font-semibold lg:text-5xl"}>
            {pricing.title}
          </h2>
          <p className="text-muted-foreground lg:text-lg">
            {pricing.description}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          {pricing.groups && pricing.groups.length > 0 && (
            <div className={`flex items-center rounded-md bg-muted p-1 text-lg ${compact ? "h-10 mb-4" : "h-12 mb-12"}`}>
              <RadioGroup
                value={group}
                className={`h-full grid-cols-${pricing.groups.length}`}
                onValueChange={(value) => {
                  setGroup(value);
                }}
              >
                {pricing.groups.map((item, i) => {
                  return (
                    <div
                      key={i}
                      className='h-full rounded-md transition-all has-[button[data-state="checked"]]:bg-white'
                    >
                      <RadioGroupItem
                        value={item.name || ""}
                        id={item.name}
                        className="peer sr-only"
                      />
                      <Label
                        htmlFor={item.name}
                        className="flex h-full cursor-pointer items-center justify-center px-7 font-semibold text-muted-foreground peer-data-[state=checked]:text-primary"
                      >
                        {item.title}
                        {item.label && (
                          <Badge
                            variant="outline"
                            className="border-primary bg-primary px-1.5 ml-1 text-primary-foreground"
                          >
                            {item.label}
                          </Badge>
                        )}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </div>
          )}
          <div
            className={`${
              compact ? "w-full" : "md:min-w-96"
            } mt-0 grid gap-4 md:gap-6 ${
              compact
                ? "md:grid-cols-3"
                : `md:grid-cols-${
                    pricing.items?.filter(
                      (item) => !item.group || item.group === group
                    )?.length
                  }`
            }`}
          >
            {pricing.items?.map((item, index) => {
              if (item.group && item.group !== group) {
                return null;
              }

              const isSelected = item.product_id === selectedId;

              return (
                <div
                  key={index}
                  onClick={() => setSelectedId(item.product_id)}
                  className={`rounded-lg ${compact ? "p-4" : "p-6"} cursor-pointer transition-all ${
                    isSelected
                      ? "border-primary border-2 bg-card text-card-foreground shadow-md"
                      : "border-muted border hover:border-muted-foreground/40"
                  }`}
                >
                  <div className="flex h-full flex-col justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        {item.title && (
                          <h3 className="text-xl font-semibold">
                            {item.title}
                          </h3>
                        )}
                        <div className="flex-1"></div>
                        {item.label && (
                          <Badge
                            variant="outline"
                            className="border-primary bg-primary px-1.5 text-primary-foreground"
                          >
                            {item.label}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-end gap-2 mb-4">
                        {item.original_price && (
                          <span className="text-xl text-muted-foreground font-semibold line-through">
                            {item.original_price}
                          </span>
                        )}
                        {item.price && (
                          <span className="text-5xl font-semibold">
                            {item.price}
                          </span>
                        )}
                        {item.unit && (
                          <span className="block font-semibold">
                            {item.unit}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      {item.features_title && (
                        <p className="mb-3 mt-6 font-semibold">
                          {item.features_title}
                        </p>
                      )}
                      {item.features && (
                        <ul className="flex flex-col gap-3">
                          {item.features.map((feature, fi) => {
                            return (
                              <li className="flex gap-2" key={`feature-${fi}`}>
                                <Check className="mt-1 size-4 shrink-0" />
                                {feature}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {item.button && (
                        <Button
                          className="w-full flex items-center justify-center gap-2 font-semibold"
                          disabled={isLoading}
                          onClick={() => {
                            if (isLoading) {
                              return;
                            }
                            handleCheckout(item);
                          }}
                        >
                          {(!isLoading ||
                            (isLoading && productId !== item.product_id)) && (
                            <p>{item.button.title}</p>
                          )}

                          {isLoading && productId === item.product_id && (
                            <p>{item.button.title}</p>
                          )}
                          {isLoading && productId === item.product_id && (
                            <Loader className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          {item.button.icon && (
                            <Icon name={item.button.icon} className="size-4" />
                          )}
                        </Button>
                      )}
                      {item.tip && (
                        <p className="text-muted-foreground text-sm mt-2">
                          {item.tip}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
