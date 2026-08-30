import { getSupabaseClient } from "@/models/db";
import { getClientIp } from "@/lib/ip";
import { runAfterResponse } from "@/lib/after-response";

/**
 * 后台操作审计（6.7/6.9 最小版；完整审计系统见 6.20）
 * 副作用经 runAfterResponse 调度：响应完成后仍被平台保证执行（serverless 冻结安全），
 * 不阻塞后台操作主流程。
 */
export async function writeAuditLog({
  admin_uuid,
  action,
  target_type = "",
  target_uuid = "",
  detail = "",
  ip = "",
}: {
  admin_uuid: string;
  action: string;
  target_type?: string;
  target_uuid?: string;
  detail?: string;
  /** 请求作用域内已解析好的 IP（after 回调内禁止再碰 headers() 等请求 API） */
  ip?: string;
}): Promise<void> {
  try {
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
  // IP 必须在注册时（请求作用域内）解析：after 回调内 headers() 不保证可用，
  // 且 getClientIp 抛错不能连累整条审计丢失（审查修复）
  const entry = { ...params, ip: "" };
  runAfterResponse(async () => {
    try {
      entry.ip = await getClientIp();
    } catch (e) {
      console.error("[audit] resolve ip failed (audit continues without ip):", e);
    }
    await writeAuditLog(entry);
  });
}
