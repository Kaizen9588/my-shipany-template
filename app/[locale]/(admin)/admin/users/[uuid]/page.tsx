import { redirect } from "next/navigation";
import { findUserByUuid, updateUserByAdmin } from "@/models/user";
import { getCreditsByUserUuid } from "@/models/credit";
import { getUserCredits, adjustCreditsByAdmin } from "@/services/credit";
import { requireAdmin } from "@/lib/auth";
import { fireAndForgetAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import moment from "moment";

/**
 * 后台用户详情（6.7）：角色/状态修改 + 手动调整积分（6.9）
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const admin = await requireAdmin();
  const { uuid } = await params;

  const user = await findUserByUuid(uuid);
  if (!user) {
    redirect("/admin/users");
  }
  const currentUser = user;

  const credits = await getUserCredits(uuid);
  const recentCredits = (await getCreditsByUserUuid(uuid, 1, 20)) || [];

  async function updateRole(formData: FormData) {
    "use server";
    const adminUser = await requireAdmin();
    const role = String(formData.get("role") || "user");
    await updateUserByAdmin(uuid, { role });
    fireAndForgetAudit({
      admin_uuid: adminUser.uuid || "",
      action: "admin.user.update",
      target_type: "user",
      target_uuid: uuid,
      detail: JSON.stringify({ role }),
    });
    redirect(`/admin/users/${uuid}`);
  }

  async function toggleStatus() {
    "use server";
    const adminUser = await requireAdmin();
    const next = currentUser.status === "banned" ? "active" : "banned";
    await updateUserByAdmin(uuid, { status: next });
    fireAndForgetAudit({
      admin_uuid: adminUser.uuid || "",
      action: "admin.user.update",
      target_type: "user",
      target_uuid: uuid,
      detail: JSON.stringify({ status: next }),
    });
    redirect(`/admin/users/${uuid}`);
  }

  async function adjustCredits(formData: FormData) {
    "use server";
    const adminUser = await requireAdmin();
    const creditsNum = parseInt(String(formData.get("credits") || "0"), 10);
    const remark = String(formData.get("remark") || "");
    if (!creditsNum || creditsNum === 0) {
      throw new Error("invalid credits");
    }
    await adjustCreditsByAdmin({
      user_uuid: uuid,
      credits: creditsNum,
      remark,
    });
    fireAndForgetAudit({
      admin_uuid: adminUser.uuid || "",
      action: "admin.user.adjust_credits",
      target_type: "user",
      target_uuid: uuid,
      detail: JSON.stringify({ credits: creditsNum, remark }),
    });
    redirect(`/admin/users/${uuid}`);
  }

  return (
    <div className="space-y-6">
      <a href="/admin/users" className="text-sm underline underline-offset-4">
        ← Back to users
      </a>

      <div className="rounded-lg border p-4">
        <h3 className="text-lg font-medium">{user.nickname || user.email}</h3>
        <p className="text-sm text-muted-foreground">{user.email}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div>UUID: {user.uuid?.slice(0, 12)}...</div>
          <div>Role: {user.role || "user"}</div>
          <div>Status: {user.status === "banned" ? "banned" : "active"}</div>
          <div>Joined: {moment(user.created_at).format("YYYY-MM-DD")}</div>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">Credits</h4>
        <p className="mb-4 text-2xl font-semibold">
          {credits.left_credits}
        </p>

        <form action={adjustCredits} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="credits">Adjust (可正可负)</Label>
            <Input
              id="credits"
              name="credits"
              type="number"
              placeholder="e.g. 100 / -50"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="remark">Remark</Label>
            <Input id="remark" name="remark" placeholder="备注" />
          </div>
          <Button type="submit">Apply</Button>
        </form>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 font-medium">Admin Actions</h4>
        <div className="flex flex-wrap gap-2">
          <form action={updateRole}>
            <select
              name="role"
              defaultValue={user.role || "user"}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              <option value="user">user</option>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
            <Button type="submit" className="ml-2" size="sm">
              Update Role
            </Button>
          </form>
          <form action={toggleStatus}>
            <Button type="submit" variant="destructive" size="sm">
              {user.status === "banned" ? "Unban" : "Ban"}
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
