import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { findUserByUuid } from "@/models/user";
import { getCreditsByUserUuid } from "@/models/credit";
import { getUserCredits } from "@/services/credit";
import { requireAdmin } from "@/lib/auth";
import { parseReason } from "@/lib/admin-reason";
import { submitApproval } from "@/lib/admin-approval";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import moment from "moment";

/**
 * 后台用户详情（6.7）：角色/状态修改 + 手动调整积分（6.9）
 * N-6 双人复核：三个高危操作均落审批单（/admin/approvals 批准即执行），
 * 不再直接生效。单管理员部署自动降级批准照常执行（单据留痕）。
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const admin = await requireAdmin();
  const { uuid } = await params;
  const locale = await getLocale();

  const user = await findUserByUuid(uuid);
  if (!user) {
    redirect({ href: "/admin/users", locale });
  }
  const currentUser = user;

  const credits = await getUserCredits(uuid);
  const recentCredits = (await getCreditsByUserUuid(uuid, 1, 20)) || [];

  async function updateRole(formData: FormData) {
    "use server";
    // 2.7：改角色是授权操作，仅 super_admin；operator/admin 不能自我提权
    const adminUser = await requireAdmin("super_admin");
    const role = String(formData.get("role") || "user");
    if (!["user", "operator", "admin", "super_admin"].includes(role)) {
      throw new Error("invalid role");
    }
    // N-6：改角色是授权变更，理由必填并写入审计
    const parsed = parseReason(formData.get("reason"));
    if (!parsed.ok) {
      throw new Error(`reason required: ${parsed.error}`);
    }
    await submitApproval({
      action: "user_role",
      requester: adminUser,
      reason: parsed.reason,
      target_uuid: uuid,
      payload: { user_uuid: uuid, role },
    });
    redirect({ href: `/admin/users/${uuid}`, locale });
  }

  async function toggleStatus(formData: FormData) {
    "use server";
    // 2.7：封禁/解封是 admin 级操作
    const adminUser = await requireAdmin("admin");
    // N-6：封禁影响用户访问与在期权益，理由必填并写入审计
    const parsed = parseReason(formData.get("reason"));
    if (!parsed.ok) {
      throw new Error(`reason required: ${parsed.error}`);
    }
    const next = currentUser.status === "banned" ? "active" : "banned";
    await submitApproval({
      action: "user_status",
      requester: adminUser,
      reason: parsed.reason,
      target_uuid: uuid,
      payload: { user_uuid: uuid, status: next },
    });
    redirect({ href: `/admin/users/${uuid}`, locale });
  }

  async function adjustCredits(formData: FormData) {
    "use server";
    // 2.7：调整积分是资金操作，需 admin 级
    const adminUser = await requireAdmin("admin");
    const creditsNum = parseInt(String(formData.get("credits") || "0"), 10);
    // N-6：调整积分是资金操作，理由必填（与 /api/admin/user/credits 同规则）
    const parsed = parseReason(formData.get("reason"));
    if (!parsed.ok) {
      throw new Error(`reason required: ${parsed.error}`);
    }
    if (!creditsNum || creditsNum === 0) {
      throw new Error("invalid credits");
    }
    await submitApproval({
      action: "adjust_credits",
      requester: adminUser,
      reason: parsed.reason,
      target_uuid: uuid,
      payload: { user_uuid: uuid, credits: creditsNum },
    });
    redirect({ href: `/admin/users/${uuid}`, locale });
  }

  return (
    <div className="space-y-6">
      <a href="/admin/users" className="text-sm underline underline-offset-4">
        ← 返回用户列表
      </a>

      <div className="rounded-lg border p-4">
        <h3 className="text-lg font-medium">
          {currentUser.nickname || currentUser.email}
        </h3>
        <p className="text-sm text-muted-foreground">{currentUser.email}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div>UUID: {currentUser.uuid?.slice(0, 12)}...</div>
          <div>角色：{currentUser.role || "user"}</div>
          <div>状态：{currentUser.status === "banned" ? "已封禁" : "正常"}</div>
          <div>注册：{moment(currentUser.created_at).format("YYYY-MM-DD")}</div>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">积分</h4>
        <p className="mb-4 text-2xl font-semibold">
          {credits.left_credits}
        </p>

        <form action={adjustCredits} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="credits">调整（可正可负）</Label>
            <Input
              id="credits"
              name="credits"
              type="number"
              placeholder="e.g. 100 / -50"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reason">理由（必填，写入审计日志）</Label>
            <Textarea
              id="reason"
              name="reason"
              required
              minLength={5}
              maxLength={200}
              placeholder="例如：客诉补偿，工单 #1234"
              className="w-64"
            />
          </div>
          <Button type="submit">应用</Button>
        </form>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">管理员操作</h4>
        <div className="flex flex-wrap gap-6">
          <form action={updateRole} className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="role">角色</Label>
              <select
                id="role"
                name="role"
                defaultValue={currentUser.role || "user"}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                <option value="user">user</option>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-reason">理由（必填）</Label>
              <Input
                id="role-reason"
                name="reason"
                required
                minLength={5}
                maxLength={200}
                placeholder="例如：运营转管理员，工单 #5678"
                className="w-64"
              />
            </div>
            <Button type="submit" size="sm">
              提交角色变更审批
            </Button>
          </form>
          <form action={toggleStatus} className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="status-reason">理由（必填）</Label>
              <Input
                id="status-reason"
                name="reason"
                required
                minLength={5}
                maxLength={200}
                placeholder="例如：恶意退款，封禁调查"
                className="w-64"
              />
            </div>
            <Button type="submit" variant="destructive" size="sm">
              {currentUser.status === "banned" ? "提交解封审批" : "提交封禁审批"}
            </Button>
          </form>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">Recent Credit Transactions</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Trans No</th>
              <th>Type</th>
              <th>Credits</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {recentCredits.map((c) => (
              <tr key={c.trans_no} className="border-b">
                <td className="py-2 font-mono text-xs">{c.trans_no.slice(-8)}</td>
                <td>{c.trans_type}</td>
                <td className={c.credits > 0 ? "text-green-600" : "text-red-600"}>
                  {c.credits > 0 ? `+${c.credits}` : c.credits}
                </td>
                <td>{moment(c.created_at).format("YYYY-MM-DD HH:mm")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
