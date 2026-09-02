-- 第二十批（2026-09-01）：P0-定价-1 剩余——定价/渠道配置事务化批量写入
--
-- 问题（handoff §1.9/§3 P0-定价-1 剩余）：
--   审批队列批准后，lib/admin-approval 逐条调用 updatePaymentProduct /
--   updatePaymentSettingDetail（每次一条 UPDATE，各自独立 autocommit）。
--   一次审批含 N 条定价 + M 个渠道开关时，中途失败（DB 闪断/网络抖动）会把
--   payment_products / payment_settings 留在半更新状态：
--   - 定价真相源自身不一致（例如 amount 已改、credits 未改——积分≤金额
--     不变量在「两行中间态」可能被打破，出现低价高积分的可套利定价）
--   - 渠道启停与定价不同步（如关闭旧渠道后新产品价未生效/旧价仍可购）
--   审批单会置 failed 可重试，但重试前的窗口内线上就是半套定价。
--
-- 设计：单个 SECURITY DEFINER RPC 内完成全部写入——PostgreSQL 函数体
-- 原子执行（任一语句抛错即整体回滚）。不变量（金额/积分/有效期上限、
-- 积分≤金额、渠道白名单）在 DB 层再验一次（此前只存在于应用层，直连
-- service_role 的 RPC 调用可绕过应用校验；纵深防御）。payload 为 JSONB，
-- 与审批单快照同构（{ settings: [...], products: [...] }）。
--
-- 迁移器单事务执行；函数整体重建保证幂等。

-- ============ 1. 事务化批量写入 RPC ============

CREATE OR REPLACE FUNCTION private.apply_payment_config(
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_settings  JSONB;
  v_products  JSONB;
  v_prod      JSONB;
  v_setting   JSONB;
  v_updated_products INT := 0;
  v_updated_settings INT := 0;
  v_amount    INT;
  v_credits   INT;
  v_months    INT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'payload is required';
  END IF;

  v_settings := COALESCE(p_payload->'settings', '[]'::jsonb);
  v_products := COALESCE(p_payload->'products', '[]'::jsonb);

  IF jsonb_typeof(v_products) <> 'array' OR jsonb_typeof(v_settings) <> 'array' THEN
    RAISE EXCEPTION 'settings and products must be arrays';
  END IF;

  -- ============ 2. 全量校验（先验后写，防半套定价） ============
  FOR v_prod IN SELECT * FROM jsonb_array_elements(v_products) LOOP
    -- product_id 必填（WHERE product_id 无守卫的 UPDATE 是空操作，静默跳过会掩盖错误）
    IF COALESCE(v_prod->>'product_id', '') = '' THEN
      RAISE EXCEPTION 'product_id is required';
    END IF;
    v_amount := CASE WHEN jsonb_typeof(v_prod->'amount') = 'number'
                     THEN floor((v_prod->>'amount')::numeric)::INT END;
    v_credits := CASE WHEN jsonb_typeof(v_prod->'credits') = 'number'
                      THEN floor((v_prod->>'credits')::numeric)::INT END;
    v_months := CASE WHEN jsonb_typeof(v_prod->'valid_months') = 'number'
                     THEN floor((v_prod->>'valid_months')::numeric)::INT END;

    -- 与 lib/pricing-guard 同规（DB 层纵深防御）：字段级不变量
    IF v_amount IS NOT NULL AND (v_amount <= 0 OR v_amount > 1000000) THEN
      RAISE EXCEPTION 'amount must be a positive integer not exceeding 1000000';
    END IF;
    IF v_credits IS NOT NULL AND (v_credits <= 0 OR v_credits > 1000000) THEN
      RAISE EXCEPTION 'credits must be a positive integer not exceeding 1000000';
    END IF;
    IF v_months IS NOT NULL AND (v_months <= 0 OR v_months > 120) THEN
      RAISE EXCEPTION 'valid_months must be a positive integer not exceeding 120';
    END IF;
    -- 反赠送定价：积分 ≤ 金额（分）
    IF v_amount IS NOT NULL AND v_credits IS NOT NULL AND v_credits > v_amount THEN
      RAISE EXCEPTION 'credits must not exceed amount (no giveaway pricing)';
    END IF;
    -- 币种白名单（v1 仅 USD；与路由同规）
    IF v_prod->>'currency' IS NOT NULL AND v_prod->>'currency' <> 'USD' THEN
      RAISE EXCEPTION 'v1 only supports USD currency';
    END IF;

    -- 目标产品必须已存在（ Upsert 不允许——定价行创建走种子/迁移，不走管理端）
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_products
      WHERE product_id = v_prod->>'product_id'
    ) THEN
      RAISE EXCEPTION 'product not found: %', v_prod->>'product_id';
    END IF;
  END LOOP;

  FOR v_setting IN SELECT * FROM jsonb_array_elements(v_settings) LOOP
    IF COALESCE(v_setting->>'provider', '') = '' THEN
      RAISE EXCEPTION 'provider is required';
    END IF;
    -- enabled 必须是 boolean、priority 必须是非负数（拒绝类型混淆）
    IF v_setting->'enabled' <> 'null'::jsonb
       AND jsonb_typeof(v_setting->'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'enabled must be a boolean';
    END IF;
    IF v_setting->'priority' <> 'null'::jsonb
       AND (jsonb_typeof(v_setting->'priority') <> 'number'
            OR (v_setting->>'priority')::numeric < 0) THEN
      RAISE EXCEPTION 'priority must be a non-negative number';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_settings
      WHERE provider = v_setting->>'provider'
    ) THEN
      RAISE EXCEPTION 'payment setting not found: %', v_setting->>'provider';
    END IF;
  END LOOP;

  -- ============ 3. 原子写入（任一失败整体回滚） ============
  FOR v_setting IN SELECT * FROM jsonb_array_elements(v_settings) LOOP
    UPDATE public.payment_settings
    SET enabled = COALESCE((v_setting->>'enabled')::boolean, enabled),
        priority = COALESCE(floor((v_setting->>'priority')::numeric)::INT, priority),
        updated_at = now()
    WHERE provider = v_setting->>'provider';
    v_updated_settings := v_updated_settings + 1;
  END LOOP;

  FOR v_prod IN SELECT * FROM jsonb_array_elements(v_products) LOOP
    UPDATE public.payment_products
    SET amount        = COALESCE(floor((v_prod->>'amount')::numeric)::INT, amount),
        credits       = COALESCE(floor((v_prod->>'credits')::numeric)::INT, credits),
        valid_months  = COALESCE(floor((v_prod->>'valid_months')::numeric)::INT, valid_months),
        currency      = COALESCE(v_prod->>'currency', currency),
        creem_product_id  = COALESCE(v_prod->>'creem_product_id', creem_product_id),
        stripe_price_id   = COALESCE(v_prod->>'stripe_price_id', stripe_price_id),
        waffo_product_id  = COALESCE(v_prod->>'waffo_product_id', waffo_product_id)
    WHERE product_id = v_prod->>'product_id';
    v_updated_products := v_updated_products + 1;
  END LOOP;

  RETURN jsonb_build_object('settings_updated', v_updated_settings,
                            'products_updated', v_updated_products);
END $$;

-- ============ 4. 权限收口：REVOKE + 仅授 service_role（0023/0028/0029 同规）============
REVOKE ALL ON FUNCTION private.apply_payment_config(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_payment_config(JSONB) TO service_role;
