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
  // 复审 2：UPDATE 补 status='created' 守卫 —— 否则 SELECT 与 UPDATE 之间若有
  // 迟到 webhook 把订单 recovered→paid（0017），cron 会无条件把它改回 expired，
  // 造成「已付款订单状态错乱」；守卫后只会过期仍处于 created 的订单。
  const { error } = await supabase
    .from("orders")
    .update({ status: "expired" })
    .eq("status", "created")
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
