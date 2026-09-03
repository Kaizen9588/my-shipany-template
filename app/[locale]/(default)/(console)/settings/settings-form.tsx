"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * 个人资料设置（6.11）：昵称 / 语言偏好 / 头像上传
 */
export default function SettingsForm({
  initial,
}: {
  initial: { nickname?: string; email?: string; avatar_url?: string; locale?: string };
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(initial.nickname || "");
  const [locale, setLocale] = useState(initial.locale || "en");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const resp = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, locale }),
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("Profile updated");
      router.refresh();
    } catch (e) {
      toast.error("update failed");
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/user/avatar", {
        method: "POST",
        body: formData,
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("Avatar updated");
      router.refresh();
    } catch (e) {
      toast.error("upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <div className="flex items-center gap-4">
        <img
          src={initial.avatar_url || "/logo.png"}
          alt="avatar"
          className="h-16 w-16 rounded-full object-cover"
        />
        <div>
          <Label htmlFor="avatar" className="cursor-pointer">
            <span className="rounded-md border px-3 py-1.5 text-sm">
              {uploading ? "Uploading..." : "Upload Avatar"}
            </span>
          </Label>
          <input
            id="avatar"
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                uploadAvatar(file);
              }
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={initial.email || ""} disabled />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nickname">Nickname</Label>
        <Input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locale">Language</Label>
        <select
          id="locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className="w-full rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </div>

      <Button onClick={saveProfile} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
