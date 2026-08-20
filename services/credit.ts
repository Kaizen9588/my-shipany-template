import {
  findCreditByOrderNo,
  getUserValidCredits,
  insertCredit,
} from "@/models/credit";

import { Credit } from "@/types/credit";
import { Order } from "@/types/order";
import { UserCredits } from "@/types/user";
import { findUserByUuid } from "@/models/user";
import { getFirstPaidOrderByUserUuid } from "@/models/order";
import { getIsoTimestr } from "@/lib/time";
import { getSnowId } from "@/lib/hash";
import { getSupabaseClient } from "@/models/db";
import { fireAndForgetEmail, shouldSendToday } from "@/lib/email";
import { createNotification } from "@/models/notification";
import { TelemetryEvents, trackServer } from "@/lib/telemetry/server";

export enum CreditsTransType {
  NewUser = "new_user", // initial credits for new user
  OrderPay = "order_pay", // user pay for credits
  SystemAdd = "system_add", // system add credits
  Ping = "ping", // cost for ping api
  AiGenerate = "ai_generate", // AI 调用扣费（负数，一次扣清，见 docs/13）
  AiRefund = "ai_refund", // AI 失败退款（正数回补，仅服务端异常时）
  OrderRefund = "order_refund", // 订单退款扣回积分（负数，见 6.1 退款口径）
}

export enum CreditsAmount {
  NewUserGet = 10,
  PingCost = 1,
}

/** 积分不足错误（P-1.2：扣减前余额校验，不足时抛出） */
export class InsufficientCreditsError extends Error {
  balance: number;

  constructor(balance: number) {
    super(`insufficient credits: ${balance}`);
    this.name = "InsufficientCreditsError";
    this.balance = balance;
  }
}

export async function getUserCredits(user_uuid: string): Promise<UserCredits> {
  let user_credits: UserCredits = {
    left_credits: 0,
  };

  try {
    const first_paid_order = await getFirstPaidOrderByUserUuid(user_uuid);
    if (first_paid_order) {
      user_credits.is_recharged = true;
    }

    const credits = await getUserValidCredits(user_uuid);
    if (credits) {
      credits.forEach((v: Credit) => {
        user_credits.left_credits += v.credits;
      });
    }

    if (user_credits.left_credits < 0) {
      user_credits.left_credits = 0;
    }

    if (user_credits.left_credits > 0) {
      user_credits.is_pro = true;
    }

    return user_credits;
  } catch (e) {
    console.log("get user credits failed: ", e);
    return user_credits;
  }
}

/**
 * 原子扣减积分（P-1.2）
 *
 * 通过数据库存储过程 decrease_credits 实现：
 * - 行锁串行化同一用户并发扣减
 * - 扣减前校验余额，不足抛 InsufficientCreditsError
 * - FIFO 从最早过期的正数积分消耗
 * - 负数扣减记录 expired_at 为 NULL（永久消费，不随原积分过期消失）
 */
export async function decreaseCredits({
  user_uuid,
  trans_type,
  credits,
}: {
  user_uuid: string;
  trans_type: CreditsTransType;
  credits: number;
}) {
  const trans_no = getSnowId();
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("decrease_credits", {
    p_user_uuid: user_uuid,
    p_trans_type: trans_type,
    p_credits: credits,
    p_trans_no: trans_no,
  });

  if (error) {
    const match = error.message.match(/insufficient credits: (-?\d+)/);
    if (match) {
      throw new InsufficientCreditsError(parseInt(match[1], 10));
    }
    console.log("decrease credits failed: ", error);
    throw error;
  }

  // 6.2：积分低余额/耗尽邮件提醒（fire-and-forget，不阻塞主流程；docs/10 §4.1）
  notifyCreditBalance(user_uuid);

  return trans_no;
}

/**
 * 积分余额提醒：低于阈值发 credit_low，耗尽发 credit_exhausted。
 * - fire-and-forget：不 await，绝不影响扣减主流程
 * - 节流：同用户同类型同一天只发一次（shouldSendToday）
 */
function notifyCreditBalance(user_uuid: string): void {
  void (async () => {
    try {
      const user = await findUserByUuid(user_uuid);
      if (!user?.email) {
        return;
      }

      const left = await getUserCredits(user_uuid);
      const threshold =
        parseInt(process.env.CREDIT_LOW_THRESHOLD || "10", 10) || 10;

      if (left.left_credits <= 0) {
        // 6.14：积分耗尽站内通知
        void createNotification({
          user_uuid,
          type: "credit",
          title: "Credits exhausted",
          content: "Your credits are used up. Recharge to continue.",
        });
        // 6.5：积分耗尽埋点（服务端真相源）
        trackServer({
          name: TelemetryEvents.CreditsExhausted,
          distinctId: user_uuid,
        });
        if (!shouldSendToday(`credit_exhausted:${user_uuid}`)) {
          return;
        }
        fireAndForgetEmail({
          to: user.email,
          template: "credit_exhausted",
          variables: {
            left_credits: 0,
          },
          category: "transactional",
        });
      } else if (left.left_credits < threshold) {
        if (!shouldSendToday(`credit_low:${user_uuid}`)) {
          return;
        }
        fireAndForgetEmail({
          to: user.email,
          template: "credit_low",
          variables: {
            left_credits: left.left_credits,
            threshold,
          },
          category: "transactional",
        });
      }
    } catch (e) {
      console.error("[credit] notify credit balance failed:", e);
    }
  })();
}

export async function increaseCredits({
  user_uuid,
  trans_type,
  credits,
  expired_at,
  order_no,
}: {
  user_uuid: string;
  trans_type: string;
  credits: number;
  expired_at?: string;
  order_no?: string;
}) {
  try {
    // 修复（对抗性测试，与 adjustCreditsByAdmin 同源）：expired_at 为空串时
    // Postgres timestamptz 解析失败（22007）。NULL 才是「长期有效」的正确表示，
    // 与 decrease_credits / getUserValidCredits 的「NULL 永不过期」口径一致。
    const new_credit: Credit = {
      trans_no: getSnowId(),
      created_at: getIsoTimestr(),
      user_uuid: user_uuid,
      trans_type: trans_type,
      credits: credits,
      order_no: order_no || "",
      expired_at: expired_at
        ? expired_at
        : (null as unknown as string),
    };
    await insertCredit(new_credit);
  } catch (e) {
    console.log("increase credits failed: ", e);
    throw e;
  }
}

export async function updateCreditForOrder(order: Order) {
  try {
    const credit = await findCreditByOrderNo(order.order_no);
    if (credit) {
      // order already increased credit
      return;
    }

    await increaseCredits({
      user_uuid: order.user_uuid,
      trans_type: CreditsTransType.OrderPay,
      credits: order.credits,
      expired_at: order.expired_at,
      order_no: order.order_no,
    });
  } catch (e) {
    console.log("update credit for order failed: ", e);
    throw e;
  }
}

/**
 * 管理员手动增减积分（6.9，system_add）
 * - credits > 0：增加，不设有效期（expired_at = NULL 长期有效，与 decrease_credits RPC
 *   的「NULL 永不过期」语义一致）
 * - credits < 0：扣减，expired_at 为 NULL（永久消费，与 P-1.2 负数记录语义一致）
 *
 * 修复（对抗性测试）：此前正数分支 expired_at 传 ""（空字符串），Postgres
 * timestamptz 解析失败（22007），管理员加积分永远报错。NULL 才是"长期有效"的正确表示。
 */
export async function adjustCreditsByAdmin({
  user_uuid,
  credits,
  remark,
}: {
  user_uuid: string;
  credits: number;
  remark?: string;
}): Promise<void> {
  if (credits === 0) {
    throw new Error("invalid credits amount");
  }

  const credit: Credit = {
    trans_no: getSnowId(),
    created_at: getIsoTimestr(),
    user_uuid: user_uuid,
    trans_type: CreditsTransType.SystemAdd,
    credits: credits,
    order_no: remark || "",
    expired_at: null as unknown as string,
  };
  await insertCredit(credit);
}
