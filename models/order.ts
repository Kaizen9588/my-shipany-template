import { Order } from "@/types/order";
import { getSupabaseClient } from "@/models/db";
import { likeFilter } from "@/lib/postgrest";

export enum OrderStatus {
  Created = "created",
  Paid = "paid",
  Deleted = "deleted",
  Expired = "expired",
  Refunded = "refunded",
  /** 渠道实付金额/币种与订单不符（迁移 0010），待人工核查 */
  Mismatch = "mismatch",
  /** P0-1：退款已登记但回收流程未闭合（中间态） */
  RefundRequested = "refund_requested",
  /** P0-1：退款回收需人工决策（已消费超额被债务化） */
  RefundBlocked = "refund_blocked",
  /** N-13：争议进行中（冻结消费，保留余额） */
  Disputed = "disputed",
  /** N-13：拒付成立（资金已划走，账号受限） */
  ChargedBack = "charged_back",
}

export async function insertOrder(order: Order) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("orders").insert(order);

  if (error) {
    throw error;
  }

  return data;
}

export async function findOrderByOrderNo(
  order_no: string
): Promise<Order | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("order_no", order_no)
    .single();

  if (error) {
    return undefined;
  }

  return data;
}

export async function getFirstPaidOrderByUserUuid(
  user_uuid: string
): Promise<Order | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_uuid", user_uuid)
    .eq("status", "paid")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error) {
    return undefined;
  }

  return data;
}

export async function getFirstPaidOrderByUserEmail(
  user_email: string
): Promise<Order | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_email", user_email)
    .eq("status", "paid")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error) {
    return undefined;
  }

  return data;
}

export async function updateOrderSession(
  order_no: string,
  stripe_session_id: string,
  order_detail: string
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ stripe_session_id, order_detail })
    .eq("order_no", order_no);

  if (error) {
    throw error;
  }

  return data;
}

export async function updateOrderSubscription(
  order_no: string,
  sub_id: string,
  sub_interval_count: number,
  sub_cycle_anchor: number,
  sub_period_end: number,
  sub_period_start: number,
  status: string,
  paid_at: string,
  sub_times: number,
  paid_email: string,
  paid_detail: string
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .update({
      sub_id,
      sub_interval_count,
      sub_cycle_anchor,
      sub_period_end,
      sub_period_start,
      status,
      paid_at,
      sub_times,
      paid_email,
      paid_detail,
    })
    .eq("order_no", order_no);

  if (error) {
    throw error;
  }

  return data;
}

export async function getOrdersByUserUuid(
  user_uuid: string
): Promise<Order[] | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_uuid", user_uuid)
    .eq("status", "paid")
    .order("created_at", { ascending: false });

  if (error) {
    return undefined;
  }

  return data;
}

export async function getOrdersByUserEmail(
  user_email: string
): Promise<Order[] | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_email", user_email)
    .eq("status", "paid")
    .order("created_at", { ascending: false });

  if (error) {
    return undefined;
  }

  return data;
}

export async function getOrdersByPaidEmail(
  paid_email: string
): Promise<Order[] | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("paid_email", paid_email)
    .eq("status", "paid")
    .order("created_at", { ascending: false });

  if (error) {
    return undefined;
  }

  return data;
}

export async function getPaidOrders(
  page: number,
  limit: number
): Promise<Order[] | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    // L5（对抗性测试）：range 是闭区间，此前 end = page*limit 每页多取一条
    .range((page - 1) * limit, page * limit - 1);

  if (error) {
    return undefined;
  }

  return data;
}

// ---------- 6.8 后台订单管理 ----------

export async function searchPaidOrders(
  keyword: string = "",
  page: number = 1,
  limit: number = 20
): Promise<Order[] | undefined> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("orders")
    .select("*")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (keyword) {
    query = query.or(
      `${likeFilter("order_no", keyword)},${likeFilter("user_email", keyword)},${likeFilter("paid_email", keyword)},${likeFilter("product_name", keyword)}`
    );
  }

  const { data, error } = await query;
  if (error) {
    return undefined;
  }
  return data;
}

export async function countOrders(status?: string): Promise<number> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("orders")
    .select("id", { count: "exact", head: true });
  if (status) {
    query = query.eq("status", status);
  }
  const { count, error } = await query;
  if (error) {
    return 0;
  }
  return count || 0;
}
