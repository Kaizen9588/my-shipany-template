"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { signOut } from "next-auth/react";

/**
 * 删除账号（6.17 GDPR）：软删除 + 保留订单/财务数据
 */
export default function DeleteAccount() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    const ok = window.confirm(
      "删除账号将清除您的个人信息（昵称/头像/邮箱），订单与积分流水将按财务合规保留。确定继续？"
    );
    if (!ok) {
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/user/delete-account", {
        method: "POST",
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("Account deleted");
      await signOut({ redirect: false });
      router.push("/");
      router.refresh();
    } catch (e) {
      toast.error("delete failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-destructive/50 p-4">
      <h4 className="text-sm font-medium text-destructive">Danger Zone</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        删除账号后无法恢复。订单与积分流水按税务合规保留 7 年。
      </p>
      <Button
        variant="destructive"
        size="sm"
        className="mt-3"
        disabled={loading}
        onClick={handleDelete}
      >
        {loading ? "Deleting..." : "Delete Account"}
      </Button>
    </div>
  );
}
