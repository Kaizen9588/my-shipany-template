"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Pricing from "@/components/blocks/pricing";
import { Pricing as PricingType } from "@/types/blocks/pricing";

/**
 * 用户中心充值弹框（my-credits 页内触发，不跳转）。
 * - compact：复用主页 <Pricing> 组件但去掉区块级大间距（消除弹框内空白）
 * - 卡片三列平铺、内容完整展示，不做内部滚动
 * - 关闭 Dialog 自带的滑入动画（data-[state=open]:animate-in → none），
 *   弹框一次性直接呈现
 */
export default function RechargeDialog({
  pricing,
  open,
  onOpenChange,
}: {
  pricing: PricingType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl p-6 data-[state=open]:animate-none data-[state=closed]:animate-none [&>*:last-child]:sr-only"
        style={{ ["--radius" as never]: undefined }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{pricing.title}</DialogTitle>
          <DialogDescription>{pricing.description}</DialogDescription>
        </DialogHeader>
        {/* 复用主页定价组件本身（选项/价格/说明/下单逻辑零拷贝）；
            compact 模式收紧间距，卡片三列全部展示 */}
        <Pricing pricing={pricing} compact />
      </DialogContent>
    </Dialog>
  );
}
