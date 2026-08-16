import { getSupabaseClient } from "../models/db";

/**
 * 定时任务：超时未支付订单置为 expired（6.16 webhook 容错）
 * 扫描 status=created 超过 1 小时的订单。
 *
 * 用法：Vercel Cron（见 vercel.json）或外部定时服务触发
 *   GET /api/cron/expire-orders?token=<CRON_TOKEN>
 */
export async function expireStaleOrders(maxAgeMinutes: number = 60): Promise<number> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

  const { data: stale, error: queryError } = await supabase
    .from("orders")
    .select("order_no")
    .eq("status", "created")
    .lt("created_at", cutoff);

  if (queryError) {
    throw queryError;
  }

  if (!stale || stale.length === 0) {
    return 0;
  }

  const orderNos = stale.map((o) => o.order_no);
  const { error } = await supabase
    .from("orders")
    .update({ status: "expired" })
    .in("order_no", orderNos);

  if (error) {
    throw error;
  }

  return orderNos.length;
}

// 直接运行：node --experimental-strip-types scripts/expire-orders.ts
if (process.argv[1] && process.argv[1].endsWith("expire-orders.ts")) {
  expireStaleOrders()
    .then((n) => console.log(`[cron] expired ${n} stale orders`))
    .catch((e) => {
      console.error("[cron] expire orders failed:", e);
      process.exit(1);
    });
}
