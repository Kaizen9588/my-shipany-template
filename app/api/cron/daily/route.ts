import { respData, respErr } from "@/lib/resp";
import { expireStaleOrders } from "@/scripts/expire-orders";
import { backupKeyTables } from "@/lib/backup";
import { cleanupVerificationCodes } from "@/models/verification";

/**
 * GET /api/cron/daily -- 每日定时任务（6.16）
 * 1. 超时未支付订单置为 expired
 * 2. 过期验证码清理（2.15）
 * 3. 关键表备份到 S3
 *
 * 安全（2.13 修复）：Vercel Cron 自动带 Authorization: Bearer <CRON_SECRET> 头。
 * 此前端点在 CRON_SECRET 未设置时完全跳过校验，且会触发 users 全量导出上传--
 * 任何人 GET 一次即放大一次全表导出。现改为：
 * - 生产环境未设置 CRON_SECRET -> 拒绝执行（fail fast，部署缺陷要暴露不能静默）
 * - 开发环境（NODE_ENV !== production）保留无密钥执行以便本地测试
 */
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
      console.error(
        "[cron/daily] CRON_SECRET is not set; refusing to run in production"
      );
      return respErr("cron secret not configured", 500);
    }
    if (secret) {
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace("Bearer ", "");
      if (token !== secret) {
        return respErr("unauthorized", 401);
      }
    }

    const expired = await expireStaleOrders(60);
    const cleaned = await cleanupVerificationCodes();
    const backup = await backupKeyTables();

    return respData({
      expired_orders: expired,
      cleaned_verification_codes: cleaned,
      backup_files: backup.exported,
      backup_error: backup.error || undefined,
    });
  } catch (e: any) {
    console.error("[cron/daily] failed:", e);
    return respErr("cron failed");
  }
}
