-- 第十三批（2026-09-02）：N-13 剩余——联盟奖励冲销（退款/拒付联动）
--
-- 背景（docs/05 §3.4 / §7.2）：联盟佣金在 handle_order_payment 里随订单支付写入
-- affiliates（status='completed'，reward_amount = min(amount*20%, $50)）。
-- 此前退款（processRefund）与拒付成立（dispute_lost）只回收用户积分/冻结账号，
-- 从不冲销佣金——邀请人保留全额佣金，构成「退款套利」（邀请人与被邀请人合谋：
-- 首付拿佣金 → 退款，佣金落袋）。
--
-- 本迁移提供统一冲销入口（幂等）：
--   private.reverse_affiliate_reward(p_order_no, p_reason) RETURNS INT
-- 把该订单的 completed 佣金置 reversed（终态，不可再冲销/复用），
-- 返回冲销金额（0 = 无佣金或已冲销）。
--
-- 状态机：completed --冲销--> reversed（终态）。
-- 历史口径兼容：0017 的部分唯一索引 affiliates_single_completed_per_user
--   WHERE status='completed' 在冲销后自动「让出」名额——但业务上被邀请人
--   首笔付费佣金已发出，不该因冲销再发一笔（handle_order_payment 的
--   affiliates_single_completed_per_user 部分索引只在无 completed 行时放行新写入，
--   冲销后新订单会再建 completed 佣金——这是可接受的：新订单是新的真实付费）。
--
-- 权限：与 0026 同规，private schema + REVOKE + 仅授 service_role。

CREATE OR REPLACE FUNCTION private.reverse_affiliate_reward(
  p_order_no TEXT,
  p_reason TEXT DEFAULT ''
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_reward INT;
BEGIN
  -- 行锁防并发双冲销；completed 才可冲销（幂等：reversed 再次调用返回 0）
  SELECT reward_amount INTO v_reward
  FROM affiliates
  WHERE paid_order_no = p_order_no AND status = 'completed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE affiliates
  SET status = 'reversed'
  WHERE paid_order_no = p_order_no AND status = 'completed';

  -- 冲销原因进 paid_order_no 不合适；affiliates 无 remark 列，原因只进调用方审计
  -- （admin.order.refund / payment.dispute_lost / payment.refund_processed detail）。
  IF COALESCE(p_reason, '') <> '' THEN
    -- no-op：保留参数以便调用方语义对齐 settle_credit_debt 的签名习惯
    NULL;
  END IF;

  RETURN COALESCE(v_reward, 0);
END $$;

REVOKE ALL ON FUNCTION private.reverse_affiliate_reward(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reverse_affiliate_reward(TEXT, TEXT) TO service_role;
