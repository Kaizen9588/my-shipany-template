import { respData, respErr } from "@/lib/resp";
import { expireStaleOrders } from "@/scripts/expire-orders";
import { backupKeyTables } from "@/lib/backup";
import { cleanupVerificationCodes } from "@/models/verification";
import { cleanupAnonymousUsage } from "@/models/anonymous-usage";
import { outboxMaintenance } from "@/lib/oplog";
import { replayPendingEvents, reconcilePayments } from "@/lib/webhook-inbox";
import {
  cleanupCompletedAiRequests,
  compensateStaleAiRequests,
} from "@/lib/ai-request";

/**
 * GET /api/cron/daily -- 每日定时任务（6.16）
 * 1. 超时未支付订单置为 expired
 * 2. 过期验证码清理（2.15）
 * 3. 匿名试用用量清理（docs/14 §2.6，30 天前记录）
 * 4. 关键表备份到 S3
 * 5. 运营事件 outbox 兜底投递 + dead 死信清理（N-4，迁移 0029）
 * 6. 支付事件 inbox 重放（pending/failed 超 5 分钟）+ 每日对账（P1，迁移 0031）
 * 7. AI 请求崩溃补偿（running 超 30 分钟 / refund_pending 超 10 分钟退款）
 *    + 幂等键 TTL 清理（completed 超 24h，P1，迁移 0032）
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
    const cleanedAnonUsage = await cleanupAnonymousUsage(30);
    const backup = await backupKeyTables();
    const outbox = await outboxMaintenance();
    // 支付事件 inbox 重放 + 对账（P1-2）；失败不阻塞其他 cron 任务
    const inbox = { replayed: 0, processed: 0, failed: 0 };
    const reconcile = {
      checked_paid_orders: 0,
      missing_events: 0,
      failed_events: 0,
      amount_mismatches: 0,
    };
    let inboxError = "";
    try {
      const replayResult = await replayPendingEvents(20);
      inbox.replayed = replayResult.replayed;
      inbox.processed = replayResult.processed;
      inbox.failed = replayResult.failed;
      Object.assign(reconcile, await reconcilePayments());
    } catch (e: any) {
      inboxError = String(e?.message || e);
      console.error("[cron/daily] payment inbox/reconcile failed:", e);
    }

    // AI 请求崩溃补偿 + 幂等键 TTL 清理（P1-AI，迁移 0032）；失败不阻塞其他任务
    const aiRecover = { compensated: 0, refunded: 0, still_pending: 0, cleaned: 0 };
    let aiError = "";
    try {
      const recover = await compensateStaleAiRequests(20);
      aiRecover.compensated = recover.compensated;
      aiRecover.refunded = recover.refunded;
      aiRecover.still_pending = recover.still_pending;
      aiRecover.cleaned = await cleanupCompletedAiRequests(24);
    } catch (e: any) {
      aiError = String(e?.message || e);
      console.error("[cron/daily] ai request compensation failed:", e);
    }

    return respData({
      expired_orders: expired,
      cleaned_verification_codes: cleaned,
      cleaned_anonymous_usage: cleanedAnonUsage,
      backup_files: backup.exported,
      backup_error: backup.error || undefined,
      outbox_delivered: outbox.delivered,
      outbox_deduped: outbox.deduped,
      outbox_failed: outbox.failed,
      outbox_cleaned_dead: outbox.cleaned_dead,
      inbox_replayed: inbox.replayed,
      inbox_processed: inbox.processed,
      inbox_failed: inbox.failed,
      reconcile_checked_paid_orders: reconcile.checked_paid_orders,
      reconcile_missing_events: reconcile.missing_events,
      reconcile_failed_events: reconcile.failed_events,
      reconcile_amount_mismatches: reconcile.amount_mismatches,
      ...(inboxError ? { inbox_error: inboxError } : {}),
      ai_compensated: aiRecover.compensated,
      ai_refunded: aiRecover.refunded,
      ai_still_pending: aiRecover.still_pending,
      ai_cleaned: aiRecover.cleaned,
      ...(aiError ? { ai_error: aiError } : {}),
    });
  } catch (e: any) {
    console.error("[cron/daily] failed:", e);
    return respErr("cron failed");
  }
}
