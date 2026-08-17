import { TableColumn } from "@/types/blocks/table";
import TableSlot from "@/components/dashboard/slots/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { searchUsers } from "@/models/user";
import { requireAdmin } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import moment from "moment";

/**
 * 后台用户管理列表（6.7）：搜索 + 分页 + 角色/状态标识 + 详情入口
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q = "", page = "1" } = await searchParams;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const users = (await searchUsers(q, pageNum, 20)) || [];

  const columns: TableColumn[] = [
    { name: "uuid", title: "UUID", callback: (row) => row.uuid?.slice(0, 8) + "..." },
    { name: "email", title: "邮箱" },
    { name: "nickname", title: "昵称" },
    {
      name: "role",
      title: "角色",
      callback: (row) => (
        <Badge variant={row.role === "user" ? "outline" : "default"}>
          {row.role || "user"}
        </Badge>
      ),
    },
    {
      name: "status",
      title: "状态",
      callback: (row) => (row.status === "banned" ? "🚫 已封禁" : "正常"),
    },
    {
      name: "created_at",
      title: "注册时间",
      callback: (row) => moment(row.created_at).format("YYYY-MM-DD"),
    },
    {
      name: "manage",
      title: "",
      callback: (row) => (
        <a
          href={`/admin/users/${row.uuid}`}
          className="text-sm text-primary underline underline-offset-4"
        >
          管理
        </a>
      ),
    },
  ];

  const table: TableSlotType = {
    title: "全部用户",
    columns,
    data: users,
  };

  const prevPage = pageNum > 1 ? pageNum - 1 : null;
  const nextPage = users.length === 20 ? pageNum + 1 : null;

  return (
    <div className="space-y-4">
      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="搜索邮箱/昵称/UUID…"
          className="rounded-md border px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">
          搜索
        </button>
      </form>

      <TableSlot {...table} />

      <div className="flex gap-2 text-sm">
        {prevPage && (
          <a
            href={`/admin/users?q=${encodeURIComponent(q)}&page=${prevPage}`}
            className="rounded border px-3 py-1"
          >
            ← 上一页
          </a>
        )}
        <span className="px-2 py-1">Page {pageNum}</span>
        {nextPage && (
          <a
            href={`/admin/users?q=${encodeURIComponent(q)}&page=${nextPage}`}
            className="rounded border px-3 py-1"
          >
            下一页 →
          </a>
        )}
      </div>
    </div>
  );
}
