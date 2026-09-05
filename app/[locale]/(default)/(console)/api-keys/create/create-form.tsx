"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { createApiKeyAction } from "../actions";

export default function CreateApiKeyForm() {
  const t = useTranslations("console");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [plainKey, setPlainKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("name is required");
      return;
    }

    setLoading(true);
    try {
      const key = await createApiKeyAction(title);
      setPlainKey(key);
    } catch (e: any) {
      toast.error(e.message || "create api key failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!plainKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(plainKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error("copy failed");
    }
  };

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h3 className="text-lg font-medium">{t("create_api_key")}</h3>
        <p className="text-sm text-muted-foreground">
          The full key is shown only once. Store it safely.
        </p>
      </div>

      <Input
        placeholder="name"
        value={title}
        disabled={!!plainKey || loading}
        onChange={(e) => setTitle(e.target.value)}
      />

      {!plainKey ? (
        <Button
          className="w-full"
          disabled={loading}
          onClick={handleCreate}
        >
          {loading ? "Creating..." : "Create"}
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border p-3">
            <code className="flex-1 break-all text-sm">{plainKey}</code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleCopy}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Copy it now — it will not be shown again.
          </p>
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => router.push("/api-keys")}
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
