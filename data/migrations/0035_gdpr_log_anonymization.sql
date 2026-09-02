-- P2（handoff §4 / docs/04 §8 待补 6）：GDPR 删除覆盖 op_events 与 audit_logs
--
-- 问题：/api/user/delete-account 软删除只匿名化 users 行本身；
-- op_events（subject_uuid/ip/detail 可能含 user_uuid 与请求 IP）、
-- audit_logs（admin_uuid/target_uuid/ip）同样属于 GDPR「个人数据」范围，
-- 删除账号时不清理，等于个人数据无限期残留。
--
-- 策略（与 docs/04 §8 口径一致）：
-- - op_events：删除该用户全部事件？不可行——资金/安全事件（审计追溯）有保留义务。
--   采用「匿名化」：subject_uuid 置为 deleted+{uuid}@deleted.com 前缀占位，
--   ip 置空，detail 里的 user_uuid/order_no 保留（order_no 是财务关联键，非直接标识符；
--   uuid 占位符保留可链接性供客服对账，但不再指向真实身份）。
-- - audit_logs：target_uuid/admin_uuid 命中该用户时同理匿名化；ip 置空。
-- - 一律 UPDATE 匿名化而非 DELETE，保住审计完整性与外键可读性。
--
-- 权限：SECURITY DEFINER + 钉死 search_path；REVOKE ALL，仅授 service_role
-- （与 0023/0033 资金/配置 RPC 同一权限纪律）。匿名化是幂等操作，可安全重试。

CREATE OR REPLACE FUNCTION private.anonymize_user_personal_data(
  p_user_uuid TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_anon_id TEXT := 'deleted+' || p_user_uuid;
  v_events INT := 0;
  v_audits INT := 0;
  v_pending INT := 0;
BEGIN
  IF p_user_uuid IS NULL OR p_user_uuid = '' THEN
    RAISE EXCEPTION 'user_uuid required';
  END IF;

  -- 1. op_events：subject 命中 → 匿名占位 + 抹 IP + detail 内脱敏 user_uuid
  UPDATE public.op_events
  SET subject_uuid = v_anon_id,
      ip = NULL,
      detail = detail - 'user_uuid' - 'user_email' - 'ip'
  WHERE subject_uuid = p_user_uuid;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  -- 2. op_event_outbox 队列残留（含 pending/processing）：同口径匿名化，防止后续投递又写出真实 uuid
  UPDATE private.op_event_outbox
  SET subject_uuid = v_anon_id,
      detail = detail - 'user_uuid' - 'user_email' - 'ip'
  WHERE subject_uuid = p_user_uuid;
  GET DIAGNOSTICS v_pending = ROW_COUNT;

  -- 3. audit_logs：管理员操作的目标/操作者命中 → 匿名占位 + 抹 IP
  UPDATE public.audit_logs
  SET target_uuid = CASE WHEN target_uuid = p_user_uuid THEN v_anon_id ELSE target_uuid END,
      admin_uuid = CASE WHEN admin_uuid = p_user_uuid THEN v_anon_id ELSE admin_uuid END,
      ip = CASE WHEN admin_uuid = p_user_uuid OR target_uuid = p_user_uuid THEN NULL ELSE ip END
  WHERE admin_uuid = p_user_uuid OR target_uuid = p_user_uuid;
  GET DIAGNOSTICS v_audits = ROW_COUNT;

  RETURN jsonb_build_object(
    'op_events_anonymized', v_events,
    'outbox_anonymized', v_pending,
    'audit_logs_anonymized', v_audits
  );
END;
$$;

REVOKE ALL ON FUNCTION private.anonymize_user_personal_data(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.anonymize_user_personal_data(TEXT) TO service_role;
