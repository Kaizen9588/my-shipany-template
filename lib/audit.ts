import { getSupabaseClient } from "@/models/db";
import { getClientIp } from "@/lib/ip";

/**
 * 后台操作审计（6.7/6.9 最小版；完整审计系统见 6.20）
 * fire-and-forget：不阻塞后台操作主流程。
 */
export async function writeAuditLog({
  admin_uuid,
  action,
  target_type = "",
  target_uuid = "",
  detail = "",
}: {
  admin_uuid: string;
  action: string;
  target_type?: string;
  target_uuid?: string;
  detail?: string;
}): Promise<void> {
  try {
    const ip = await getClientIp();
    const supabase = getSupabaseClient();
    await supabase.from("audit_logs").insert({
      admin_uuid,
      action,
      target_type,
      target_uuid,
      detail,
      ip,
    });
  } catch (e) {
    console.error("[audit] write failed:", e);
  }
}

export function fireAndForgetAudit(params: {
  admin_uuid: string;
  action: string;
  target_type?: string;
  target_uuid?: string;
  detail?: string;
}): void {
  void writeAuditLog(params);
}
