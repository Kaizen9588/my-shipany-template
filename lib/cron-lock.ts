import { serverClient } from "@/models/db";

/**
 * cron 单实例锁（docs/16 §cron 运维加固，迁移 0038）
 *
 * 租约语义：try_acquire 原子 upsert，仅当上次租约过期（locked_at < now()-ttl）
 * 才拿到；持锁方崩溃时由 TTL 兜底自动过期，release 只是提前归还。
 * 锁不可用（DB 不可达）时 acquire 抛错——cron 所有任务都依赖 DB，直接失败。
 */

const LOCK_KEY = "cron:daily";
const LOCK_TTL_SECONDS = 600; // 10 分钟：覆盖 cron 全部任务的最坏时长

/** 拿到锁返回 true；已有实例持锁（未过期）返回 false；DB 异常上抛 */
export async function tryAcquireCronLock(): Promise<boolean> {
  const { data, error } = await serverClient()
    .schema("private")
    .rpc("try_acquire_cron_lock", {
      p_key: LOCK_KEY,
      p_ttl_seconds: LOCK_TTL_SECONDS,
    });
  if (error) {
    throw error;
  }
  return data === true;
}

/** 提前归还租约（尽力而为：崩溃场景由 TTL 兜底，失败不阻塞主流程收尾） */
export function releaseCronLock(): void {
  void (async () => {
    try {
      const { error } = await serverClient()
        .schema("private")
        .rpc("release_cron_lock", { p_key: LOCK_KEY });
      if (error) {
        console.error("[cron-lock] release failed:", error.message);
      }
    } catch (e) {
      console.error("[cron-lock] release failed:", e);
    }
  })();
}
