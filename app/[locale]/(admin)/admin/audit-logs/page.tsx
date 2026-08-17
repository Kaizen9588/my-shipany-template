import { getSupabaseClient } from "@/models/db";
import { requireAdmin } from "@/lib/auth";
import moment from "moment";

/**
 * 操作审计日志（6.20）
 * 后台所有写操作（用户更新/调积分/退款）记录，可追溯操作人/目标/时间。
 */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page = "1" } = await searchParams;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limit = 50;

  const supabase = getSupabaseClient();
  const { data: logs } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .range((pageNum - 1) * limit, pageNum * limit - 1);

  const rows = logs || [];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">操作审计</h3>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>详情</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  暂无审计日志
                </td>
              </tr>
            )}
            {rows.map((log: any) => (
              <tr key={log.id} className="border-b">
                <td className="p-3 whitespace-nowrap">
                  {moment(log.created_at).format("MM-DD HH:mm:ss")}
                </td>
                <td className="font-mono text-xs">{log.admin_uuid?.slice(0, 8)}</td>
                <td>{log.action}</td>
                <td className="font-mono text-xs">
                  {log.target_type}:{log.target_uuid?.slice(0, 8)}
                </td>
                <td className="max-w-xs truncate text-xs text-muted-foreground">
                  {log.detail}
                </td>
                <td>{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 text-sm">
        {pageNum > 1 && (
          <a
            href={`/admin/audit-logs?page=${pageNum - 1}`}
            className="rounded border px-3 py-1"
          >
            ← 上一页
          </a>
        )}
        <span className="px-2 py-1">Page {pageNum}</span>
        {rows.length === limit && (
          <a
            href={`/admin/audit-logs?page=${pageNum + 1}`}
            className="rounded border px-3 py-1"
          >
            下一页 →
          </a>
        )}
      </div>
    </div>
  );
}
