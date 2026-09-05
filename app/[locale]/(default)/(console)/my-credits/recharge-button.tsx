"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import RechargeDialog from "@/components/console/recharge-dialog";
import { Pricing as PricingType } from "@/types/blocks/pricing";

/**
 * 我的积分页的充值入口（6.x）：页内弹框充值，不再跳转主页。
 * 弹框内容 = 主页 <Pricing> 组件 + 同一份 landing pricing 数据。
 */
export default function RechargeButton({
  pricing,
  label,
}: {
  pricing: PricingType;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <RechargeDialog pricing={pricing} open={open} onOpenChange={setOpen} />
    </>
  );
}
