"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ProductRow {
  product_id: string;
  amount: number;
  currency?: string;
  credits: number;
  valid_months: number;
  creem_product_id?: string | null;
  stripe_price_id?: string | null;
}

export default function PricingForm({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ProductRow[]>(products);

  const setField = (
    productId: string,
    key: keyof ProductRow,
    value: string | number
  ) => {
    setRows((prev) =>
      prev.map((p) => (p.product_id === productId ? { ...p, [key]: value } : p))
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/payment-products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: rows.map((p) => ({
            product_id: p.product_id,
            amount: Number(p.amount),
            credits: Number(p.credits),
            valid_months: Number(p.valid_months),
            creem_product_id: p.creem_product_id || "",
            stripe_price_id: p.stripe_price_id || "",
          })),
        }),
      });
      const { code, message } = await resp.json();
      if (code !== 0) {
        toast.error(message);
        return;
      }
      toast.success("定价映射已保存（即时生效）");
      router.refresh();
    } catch (e) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {rows.map((p) => (
        <div key={p.product_id} className="rounded-lg border p-4">
          <div className="mb-2 font-medium">{p.product_id}</div>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label>金额(分)</Label>
              <Input
                type="number"
                value={p.amount}
                onChange={(e) => setField(p.product_id, "amount", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>积分</Label>
              <Input
                type="number"
                value={p.credits}
                onChange={(e) => setField(p.product_id, "credits", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>有效月数</Label>
              <Input
                type="number"
                value={p.valid_months}
                onChange={(e) => setField(p.product_id, "valid_months", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Creem ID</Label>
              <Input
                value={p.creem_product_id || ""}
                onChange={(e) =>
                  setField(p.product_id, "creem_product_id", e.target.value)
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Stripe Price ID</Label>
              <Input
                value={p.stripe_price_id || ""}
                onChange={(e) =>
                  setField(p.product_id, "stripe_price_id", e.target.value)
                }
              />
            </div>
          </div>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          暂无定价映射（运行迁移后自动生成）。
        </p>
      )}

      <Button onClick={save} disabled={saving}>
        {saving ? "保存中…" : "保存定价映射"}
      </Button>
    </div>
  );
}
