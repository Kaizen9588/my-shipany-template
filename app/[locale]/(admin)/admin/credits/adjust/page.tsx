import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { parseReason } from "@/lib/admin-reason";
import { submitApproval } from "@/lib/admin-approval";
import { findUserByEmail } from "@/models/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 后台手动调整积分（6.9）
 * 按邮箱定位用户（或直接 user_uuid），增减积分并备注。
 * N-6：调整积分是资金操作，理由必填 + 审批队列（双人复核）——落审批单，
 * 由另一位管理员在 /admin/approvals 批准即执行，不再直接生效。
 */
export default function AdjustCreditsPage() {
  async function adjust(formData: FormData) {
    "use server";
    const admin = await requireAdmin("admin"); // 2.7：调整积分是资金操作，需 admin 级

    const email = String(formData.get("email") || "").trim().toLowerCase();
    const user_uuid = String(formData.get("user_uuid") || "").trim();
    const creditsNum = parseInt(String(formData.get("credits") || "0"), 10);
    const parsed = parseReason(formData.get("reason"));
    if (!parsed.ok) {
      throw new Error(`reason required: ${parsed.error}`);
    }

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

    await submitApproval({
      action: "adjust_credits",
      requester: admin,
      reason: parsed.reason,
      target_uuid: targetUuid,
      payload: { user_uuid: targetUuid, credits: creditsNum },
    });

    redirect("/admin/approvals");
  }

  return (
    <div className="space-y-4">
      <a href="/admin/credits" className="text-sm underline underline-offset-4">
        ← 返回积分管理
      </a>
      <h3 className="text-lg font-medium">调整积分</h3>

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
          <Label htmlFor="credits">积分数（可正可负）</Label>
          <Input id="credits" name="credits" type="number" required placeholder="例如 100 / -50" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="reason">Reason（操作理由，必填，写入审计日志）</Label>
          <Textarea
            id="reason"
            name="reason"
            required
            minLength={5}
            maxLength={200}
            placeholder="例如：客诉补偿，工单 #1234"
          />
        </div>
        <Button type="submit">提交调整审批</Button>
      </form>
    </div>
  );
}
