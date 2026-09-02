"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { downloadCsv, rowsToCsv } from "@/lib/csv";

/** CSV 导出工具栏（6.8） */
export default function OrderActions({
  orders,
}: {
  orders: Record<string, unknown>[];
}) {
  const exportCsv = () => {
    const rows = orders.map((o) => ({
      order_no: o.order_no,
      user_email: o.user_email,
      paid_email: o.paid_email,
      product_name: o.product_name,
      amount: o.amount,
      currency: o.currency,
      payment_provider: o.payment_provider || "stripe",
      status: o.status,
      created_at: o.created_at,
      paid_at: o.paid_at,
    }));
    downloadCsv(
      `paid-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      rowsToCsv(rows)
    );
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
      Export CSV
    </Button>
  );
}

/** 单行退款按钮（6.8：按 payment_provider 分发，见 /api/admin/refund） */
export function RefundButton({ orderNo }: { orderNo: string }) {
  const [loading, setLoading] = useState(false);

  const refund = async () => {
    // N-6：退款是资金操作，服务端强制要求理由（5~200 字符），审计留痕
    const reason = window.prompt(
      `退款订单 ${orderNo}：请输入退款理由（至少 5 个字符，将写入审计日志）`,
      ""
    );
    const trimmed = (reason || "").trim();
    if (!trimmed) return;
    if (trimmed.length < 5) {
      toast.error("退款理由至少 5 个字符");
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
      if (data?.manual) {
        toast.info(data.message);
      } else if (data?.approval_required) {
        toast.success(
          data.single_admin
            ? "单管理员模式：审批单已自动批准并执行"
            : "已提交审批，等待另一位管理员批准后执行"
        );
      } else {
        toast.success(
          `refunded, deducted ${data?.deducted_credits || 0} credits`
        );
      }
      window.location.reload();
    } catch (e) {
      toast.error("refund failed");
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
      onClick={refund}
    >
      {loading ? "..." : "Refund"}
    </Button>
  );
}
