"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface SettingRow {
  provider: string;
  enabled: boolean;
  priority: number;
}

const PROVIDER_NAMES: Record<string, string> = {
  stripe: "Stripe",
  creem: "Creem",
  waffo: "Waffo",
};

export default function PaymentSettingsForm({
  settings,
}: {
  settings: SettingRow[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<SettingRow[]>(settings);
  // N-6：渠道启停/优先级是资金路径配置，保存必须带理由（服务端强制校验）
  const [reason, setReason] = useState("");

  const toggle = (provider: string, enabled: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.provider === provider ? { ...r, enabled } : r))
    );
  };
  const setPriority = (provider: string, priority: number) => {
    setRows((prev) =>
      prev.map((r) => (r.provider === provider ? { ...r, priority } : r))
    );
  };

  const save = async () => {
    if (reason.trim().length < 5) {
      toast.error("请填写变更理由（至少 5 个字符，将写入审计日志）");
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/payment-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          settings: rows.map((r) => ({
            provider: r.provider,
            enabled: r.enabled,
            priority: Number(r.priority),
          })),
        }),
      });
      const { code, message, data } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      if (data?.approval_required) {
        toast.success(
          data.single_admin
            ? "单管理员模式：审批单已自动批准并生效"
            : "已提交审批，等待另一位管理员批准后生效"
        );
      } else {
        toast.success("支付渠道设置已保存（即时生效）");
      }
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Label htmlFor="payment-reason">变更理由（必填，写入审计日志）</Label>
        <Textarea
          id="payment-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={5}
          maxLength={200}
          placeholder="例如：Waffo 渠道临时下线排查"
          className="max-w-xl"
        />
      </div>
      <div>
        <h4 className="mb-3 font-medium">渠道启用与优先级</h4>
        <div className="grid gap-3 md:grid-cols-3">
          {rows.map((r) => (
            <div key={r.provider} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {PROVIDER_NAMES[r.provider] || r.provider}
                </span>
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) => toggle(r.provider, v)}
                />
              </div>
              <div className="mt-3 space-y-1">
                <Label htmlFor={`prio-${r.provider}`}>优先级（小者优先）</Label>
                <Input
                  id={`prio-${r.provider}`}
                  type="number"
                  value={r.priority}
                  onChange={(e) =>
                    setPriority(r.provider, parseInt(e.target.value, 10) || 0)
                  }
                />
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              暂无渠道配置（运行迁移后自动生成）。
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <strong>提示：</strong>定价映射（金额 / 积分 / 有效期 / 渠道产品 ID）已在
        左侧「定价映射」菜单中独立管理。
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? "保存中…" : "保存设置"}
      </Button>
    </div>
  );
}
