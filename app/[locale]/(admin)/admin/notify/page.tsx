import { requireAdmin } from "@/lib/auth";
import {
  getNotifyConfig,
  getNotifyEventRules,
} from "@/models/notify";
import NotifySettingsForm from "./notify-form";

/**
 * 后台告警通知配置（docs/16 §5，6.23）
 * 支持飞书机器人 + 企业微信机器人；保存后即生效（写 system_settings）。
 * 支持事件级开关与级别：哪些事件可以推送到群里。
 */
export default async function NotifyAdminPage() {
  await requireAdmin();
  const [config, eventRules] = await Promise.all([
    getNotifyConfig(),
    getNotifyEventRules(),
  ]);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">告警通知配置</h3>
      <p className="text-sm text-muted-foreground">
        配置飞书 / 企业微信机器人 Webhook 后，可选择要推送的事件并设置触发级别。
        没有配置任何 Webhook 时，发送测试消息会直接报错；表格中的“接入状态”标明该事件目前在模板里是否已真实触发推送。
      </p>
      <NotifySettingsForm initial={config} initialRules={eventRules} />
    </div>
  );
}
