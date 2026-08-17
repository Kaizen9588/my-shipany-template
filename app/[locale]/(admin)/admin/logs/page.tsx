import { requireAdmin } from "@/lib/auth";
import { queryOpEvents } from "@/lib/oplog";

/**
 * 后台运营事件检索（docs/16 §3.4，6.23）
 * 按 event_type / severity / subject / 分页检索 op_events。
 */
export default async function OpLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    event_type?: string;
    severity?: string;
    subject?: string;
    page?: string;
  }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const { rows, total } = await queryOpEvents({
    event_type: sp.event_type || undefined,
    severity: sp.severity || undefined,
    subject: sp.subject || undefined,
    page: parseInt(sp.page || "1", 10) || 1,
    limit: 50,
  });
  const pageNum = Math.max(parseInt(sp.page || "1", 10) || 1, 1);
  const totalPages = Math.max(Math.ceil(total / 50), 1);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">运营事件日志</h3>

      <form method="GET" className="flex flex-wrap items-end gap-2 text-sm">
        <select
          name="event_type"
          defaultValue={sp.event_type || ""}
          className="rounded-md border px-3 py-1.5"
        >
          <option value="">全部事件类型</option>
          <option value="payment.checkout_failed">checkout_failed</option>
          <option value="payment.checkout_succeeded">checkout_succeeded</option>
          <option value="payment.provider_failure">provider_failure</option>
          <option value="payment.provider_success">provider_success</option>
          <option value="payment.provider_unhealthy">provider_unhealthy</option>
          <option value="payment.provider_recovered">provider_recovered</option>
          <option value="payment.amount_mismatch">amount_mismatch</option>
          <option value="payment.refund_processed">refund_processed</option>
        </select>

        <select
          name="severity"
          defaultValue={sp.severity || ""}
          className="rounded-md border px-3 py-1.5"
        >
          <option value="">全部级别</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="critical">critical</option>
        </select>

        <input
          name="subject"
          defaultValue={sp.subject || ""}
          placeholder="关联对象（订单号/渠道）"
          className="rounded-md border px-3 py-1.5"
        />
        <button type="submit" className="rounded-md border px-3 py-1.5">
          搜索
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">时间</th>
              <th>事件</th>
              <th>级别</th>
              <th>来源</th>
              <th>关联对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  暂无事件
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={String(row.id)} className="border-b">
                <td className="p-3 whitespace-nowrap">
                  {typeof row.created_at === "string"
                    ? row.created_at.slice(0, 16).replace("T", " ")
                    : row.created_at}
                </td>
                <td className="font-mono text-xs">{row.event_type}</td>
                <td>
                  <span
                    className={
                      row.severity === "critical"
                        ? "text-red-600"
                        : row.severity === "error"
                        ? "text-orange-600"
                        : "text-muted-foreground"
                    }
                  >
                    {row.severity}
                  </span>
                </td>
                <td>{row.source}</td>
                <td className="font-mono text-xs">{row.subject_uuid || "-"}</td>
                <td className="max-w-xs truncate text-xs text-muted-foreground">
                  {JSON.stringify(row.detail || {})}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 text-sm">
        {pageNum > 1 && (
          <a
            href={`/admin/logs?event_type=${encodeURIComponent(
              sp.event_type || ""
            )}&severity=${encodeURIComponent(
              sp.severity || ""
            )}&subject=${encodeURIComponent(
              sp.subject || ""
            )}&page=${pageNum - 1}`}
            className="rounded border px-3 py-1"
          >
            ← 上一页
          </a>
        )}
        <span className="px-2 py-1">
          第 {pageNum} / {totalPages} 页（共 {total} 条）
        </span>
        {pageNum < totalPages && (
          <a
            href={`/admin/logs?event_type=${encodeURIComponent(
              sp.event_type || ""
            )}&severity=${encodeURIComponent(
              sp.severity || ""
            )}&subject=${encodeURIComponent(
              sp.subject || ""
            )}&page=${pageNum + 1}`}
            className="rounded border px-3 py-1"
          >
            下一页 →
          </a>
        )}
      </div>
    </div>
  );
}
