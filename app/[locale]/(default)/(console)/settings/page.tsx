import Empty from "@/components/blocks/empty";
import { getUserInfo } from "@/services/user";
import SettingsForm from "./settings-form";
import DeleteAccount from "./delete-account";

/**
 * 个人资料设置（6.11）+ 删除账号（6.17 GDPR）
 */
export default async function SettingsPage() {
  const user = await getUserInfo();
  if (!user) {
    return <Empty message="no auth" />;
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Settings</h3>
      <SettingsForm
        initial={{
          nickname: user.nickname,
          email: user.email,
          avatar_url: user.avatar_url,
          locale: user.locale || "en",
        }}
      />
      <DeleteAccount />
    </div>
  );
}
