import { TableColumn } from "@/types/blocks/table";
import TableSlot from "@/components/dashboard/slots/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { searchPaidOrders } from "@/models/order";
import { getUsersByUuids } from "@/models/user";
import { requireAdmin } from "@/lib/auth";
import { formatCountry } from "@/lib/user-env";
import OrderActions, { RefundButton } from "@/components/dashboard/stats/order-actions";
import moment from "moment";

/**
 * 后台付费订单管理（6.8）：搜索 + 退款 + CSV 导出
 * 0037 用户画像：支付成功时间 + 下单用户的国家/注册设备/注册时间（本页批量联查拼装）
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

  const userUuids = [
    ...new Set(orders.map((o) => o.user_uuid).filter(Boolean)),
  ] as string[];
  const orderUsers = await getUsersByUuids(userUuids);
  const userMap = new Map(orderUsers.map((u) => [u.uuid as string, u]));

  const columns: TableColumn[] = [
    { name: "order_no", title: "订单号" },
    { name: "paid_email", title: "支付邮箱" },
    { name: "product_name", title: "产品" },
    {
      name: "amount",
      title: "金额",
      callback: (row) => `$${(row.amount / 100).toFixed(2)}`,
    },
    {
      name: "payment_provider",
      title: "渠道",
      callback: (row) => row.payment_provider || "stripe",
    },
    {
      name: "paid_at",
      title: "支付成功时间",
      callback: (row) =>
        row.paid_at ? moment(row.paid_at).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      name: "country",
      title: "国家地区",
      callback: (row) => formatCountry(userMap.get(row.user_uuid)?.country || ""),
    },
    {
      name: "signup_device",
      title: "注册设备",
      callback: (row) => userMap.get(row.user_uuid)?.signup_device || "未知",
    },
    {
      name: "user_created_at",
      title: "用户注册时间",
      callback: (row) => {
        const createdAt = userMap.get(row.user_uuid)?.created_at;
        return createdAt ? moment(createdAt).format("YYYY-MM-DD HH:mm") : "—";
      },
    },
    {
      name: "created_at",
      title: "下单时间",
      callback: (row) => moment(row.created_at).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      name: "refund",
      title: "",
      callback: (row) => <RefundButton orderNo={row.order_no} />,
    },
  ];

  const table: TableSlotType = {
    title: "已支付订单",
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
            placeholder="搜索订单/邮箱/产品…"
            className="rounded-md border px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            搜索
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
            ← 上一页
          </a>
        )}
        <span className="px-2 py-1">Page {pageNum}</span>
        {nextPage && (
          <a
            href={`/admin/paid-orders?q=${encodeURIComponent(q)}&page=${nextPage}`}
            className="rounded border px-3 py-1"
          >
            下一页 →
          </a>
        )}
      </div>
    </div>
  );
}
