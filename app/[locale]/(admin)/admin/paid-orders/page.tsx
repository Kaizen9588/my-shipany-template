import { TableColumn } from "@/types/blocks/table";
import TableSlot from "@/components/dashboard/slots/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { searchPaidOrders } from "@/models/order";
import { requireAdmin } from "@/lib/auth";
import OrderActions, { RefundButton } from "@/components/dashboard/stats/order-actions";
import moment from "moment";

/**
 * 后台付费订单管理（6.8）：搜索 + 退款 + CSV 导出
 */
export default async function PaidOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q = "", page = "1" } = await searchParams;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const orders = (await searchPaidOrders(q, pageNum, 20)) || [];

  const columns: TableColumn[] = [
    { name: "order_no", title: "Order No" },
    { name: "paid_email", title: "Paid Email" },
    { name: "product_name", title: "Product Name" },
    {
      name: "amount",
      title: "Amount",
      callback: (row) => `$${(row.amount / 100).toFixed(2)}`,
    },
    {
      name: "payment_provider",
      title: "Provider",
      callback: (row) => row.payment_provider || "stripe",
    },
    {
      name: "created_at",
      title: "Created At",
      callback: (row) => moment(row.created_at).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      name: "refund",
      title: "",
      callback: (row) => <RefundButton orderNo={row.order_no} />,
    },
  ];

  const table: TableSlotType = {
    title: "Paid Orders",
    columns,
    data: orders,
  };

  const prevPage = pageNum > 1 ? pageNum - 1 : null;
  const nextPage = orders.length === 20 ? pageNum + 1 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form method="GET" className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search order/email/product..."
            className="rounded-md border px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Search
          </button>
        </form>
        <OrderActions
          orders={orders as unknown as Record<string, unknown>[]}
        />
      </div>

      <TableSlot {...table} />

      <div className="flex gap-2 text-sm">
        {prevPage && (
          <a
            href={`/admin/paid-orders?q=${encodeURIComponent(q)}&page=${prevPage}`}
            className="rounded border px-3 py-1"
          >
            ← Prev
          </a>
        )}
        <span className="px-2 py-1">Page {pageNum}</span>
        {nextPage && (
          <a
            href={`/admin/paid-orders?q=${encodeURIComponent(q)}&page=${nextPage}`}
            className="rounded border px-3 py-1"
          >
            Next →
          </a>
        )}
      </div>
    </div>
  );
}
