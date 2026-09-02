"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * 回收工作台行内操作（P0-1 闭环）：
 * - CloseRefund：webhook 登记的 refund_requested 订单本地闭合（扣积分 + 终态），
 *   复用 /api/admin/refund 的闭合语义（不触达渠道，防双重退款）
 * - SettleDebt：credit_debt 清偿（settle_credit_debt，幂等），账号随后自动恢复
 */
export function CloseRefundButton({ orderNo }: { orderNo: string }) {
  const [loading, setLoading] = useState(false);

  const close = async () => {
    const reason = window.prompt(
      `闭合退款订单 ${orderNo}：请输入操作理由（至少 5 个字符，将写入审计日志）`,
      ""
    );
    const trimmed = (reason || "").trim();
    if (!trimmed) return;
    if (trimmed.length < 5) {
      toast.error("操作理由至少 5 个字符");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_no: orderNo, reason: trimmed }),
      });
      const { code, message, data } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      if (data?.approval_required) {
        toast.success(
          data.single_admin
            ? "单管理员模式：审批单已自动批准并执行"
            : "已提交闭合审批，等待另一位管理员批准后执行"
        );
      } else {
        toast.success(`已闭合：回收 ${data?.deducted_credits || 0} 积分`);
      }
      window.location.reload();
    } catch (e) {
      toast.error("close refund failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={close}
    >
      {loading ? "..." : "闭合退款"}
    </Button>
  );
}

export function SettleDebtButton({ debtNo }: { debtNo: string }) {
  const [loading, setLoading] = useState(false);

  const settle = async () => {
    const reason = window.prompt(
      `清偿债务 ${debtNo}：请输入清偿方式/说明（至少 5 个字符，将写入审计日志）`,
      ""
    );
    const trimmed = (reason || "").trim();
    if (!trimmed) return;
    if (trimmed.length < 5) {
      toast.error("清偿说明至少 5 个字符");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/debt-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debt_no: debtNo, reason: trimmed }),
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("债务已清偿，无其他欠款的账号已恢复");
      window.location.reload();
    } catch (e) {
      toast.error("settle failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={settle}
    >
      {loading ? "..." : "清偿"}
    </Button>
  );
}
