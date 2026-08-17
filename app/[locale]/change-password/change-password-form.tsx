"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ChangePasswordForm({
  email,
}: {
  email?: string;
}) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("密码已修改，请使用新密码重新登录");
      router.push("/");
      router.refresh();
    } catch (e) {
      toast.error("修改失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email || ""} disabled />
      </div>

      <div className="space-y-2">
        <Label htmlFor="current-password">当前密码</Label>
        <Input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="初始密码：123456"
          autoComplete="current-password"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-password">新密码</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="至少 8 位，含字母和数字"
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">确认新密码</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      <Button onClick={submit} disabled={saving} className="w-full">
        {saving ? "Saving..." : "修改密码"}
      </Button>
    </div>
  );
}
