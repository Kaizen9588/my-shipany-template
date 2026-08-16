import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { adjustCreditsByAdmin } from "@/services/credit";
import { findUserByEmail } from "@/models/user";
import { fireAndForgetAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 后台手动调整积分（6.9）
 * 按邮箱定位用户（或直接 user_uuid），增减积分并备注。
 */
export default function AdjustCreditsPage() {
  async function adjust(formData: FormData) {
    "use server";
    const admin = await requireAdmin();

    const email = String(formData.get("email") || "").trim().toLowerCase();
    const user_uuid = String(formData.get("user_uuid") || "").trim();
    const creditsNum = parseInt(String(formData.get("credits") || "0"), 10);
    const remark = String(formData.get("remark") || "").slice(0, 200);

    if (!creditsNum || creditsNum === 0) {
      throw new Error("invalid credits");
    }

    let targetUuid = user_uuid;
    if (!targetUuid && email) {
      const user = await findUserByEmail(email);
      if (!user?.uuid) {
        throw new Error("user not found");
      }
      targetUuid = user.uuid;
    }
    if (!targetUuid) {
      throw new Error("user_uuid or email is required");
    }

    await adjustCreditsByAdmin({
      user_uuid: targetUuid,
      credits: creditsNum,
      remark,
    });

    fireAndForgetAudit({
      admin_uuid: admin.uuid || "",
      action: "admin.credits.adjust",
      target_type: "user",
      target_uuid: targetUuid,
      detail: JSON.stringify({ credits: creditsNum, remark }),
    });

    redirect("/admin/credits");
  }

  return (
    <div className="space-y-4">
      <a href="/admin/credits" className="text-sm underline underline-offset-4">
        ← Back to credits
      </a>
      <h3 className="text-lg font-medium">Adjust Credits</h3>

      <form action={adjust} className="max-w-md space-y-4">
        <div className="space-y-1">
          <Label htmlFor="user_uuid">User UUID（或填邮箱）</Label>
          <Input id="user_uuid" name="user_uuid" placeholder="uuid" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email（二选一）</Label>
          <Input id="email" name="email" type="email" placeholder="user@example.com" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="credits">Credits（可正可负）</Label>
          <Input id="credits" name="credits" type="number" required placeholder="e.g. 100 / -50" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="remark">Remark（备注）</Label>
          <Input id="remark" name="remark" placeholder="原因/说明" />
        </div>
        <Button type="submit">Apply Adjustment</Button>
      </form>
    </div>
  );
}
