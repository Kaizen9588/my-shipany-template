import { getSupabaseClient } from "@/models/db";
import { requireAdmin } from "@/lib/auth";
import moment from "moment";

/**
 * 后台积分流水列表（6.9）
 */
export default async function 积分Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page = "1" } = await searchParams;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limit = 30;

  const supabase = getSupabaseClient();
  const { data: credits } = await supabase
    .from("credits")
    .select("*, users(email)")
    .order("created_at", { ascending: false })
    .range((pageNum - 1) * limit, pageNum * limit - 1);

  const rows = credits || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">积分流水</h3>
        <a
          href="/admin/credits/adjust"
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          调整积分
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">流水号</th>
              <th>用户</th>
              <th>类型</th>
              <th>积分</th>
              <th>订单号</th>
              <th>过期时间</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  暂无积分流水
                </td>
              </tr>
            )}
            {rows.map((c: any) => (
              <tr key={c.trans_no} className="border-b">
                <td className="p-3 font-mono text-xs">{c.trans_no.slice(-10)}</td>
                <td>{c.users?.email || c.user_uuid?.slice(0, 8)}</td>
                <td>{c.trans_type}</td>
                <td
                  className={
                    c.credits > 0 ? "text-green-600" : "text-red-600"
                  }
                >
                  {c.credits > 0 ? `+${c.credits}` : c.credits}
                </td>
                <td className="font-mono text-xs">{c.order_no || "-"}</td>
                <td>{c.expired_at ? c.expired_at.slice(0, 10) : "永久"}</td>
                <td>{moment(c.created_at).format("YYYY-MM-DD HH:mm")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 text-sm">
        {pageNum > 1 && (
          <a
            href={`/admin/credits?page=${pageNum - 1}`}
            className="rounded border px-3 py-1"
          >
            ← 上一页
          </a>
        )}
        <span className="px-2 py-1">Page {pageNum}</span>
        {rows.length === limit && (
          <a
            href={`/admin/credits?page=${pageNum + 1}`}
            className="rounded border px-3 py-1"
          >
            下一页 →
          </a>
        )}
      </div>
    </div>
  );
}
