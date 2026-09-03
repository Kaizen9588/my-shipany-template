import ConsoleLayout from "@/components/console/layout";
import { ReactNode } from "react";
import { Sidebar } from "@/types/blocks/sidebar";
import { getLocale, getTranslations } from "next-intl/server";
import { getUserInfo } from "@/services/user";
import { redirect } from "@/i18n/navigation";

export default async function ({ children }: { children: ReactNode }) {
  const userInfo = await getUserInfo();
  const locale = await getLocale();
  if (!userInfo || !userInfo.email) {
    redirect({ href: "/auth/signin", locale });
  }

  // 默认管理员首次登录强制改密（0027）：必须先于 status 拦截，
  // pending_activation 管理员也要先完成改密再激活账号
  if (userInfo.must_change_password) {
    redirect({ href: "/change-password", locale });
  }

  // M2（对抗性测试）：被封禁/已删除账号禁止进入控制台（此前仅校验 email 存在，
  // banned/deleted 用户持旧会话仍可浏览控制台与消耗积分）
  if (userInfo.status && userInfo.status !== "active") {
    redirect({ href: "/auth/signin", locale });
  }

  const t = await getTranslations();

  const sidebar: Sidebar = {
    nav: {
      items: [
        {
          title: t("user.my_orders"),
          url: "/my-orders",
          icon: "RiOrderPlayLine",
          is_active: false,
        },
        {
          title: t("my_credits.title"),
          url: "/my-credits",
          icon: "RiBankCardLine",
          is_active: false,
        },
        {
          title: t("my_invites.title"),
          url: "/my-invites",
          icon: "RiMoneyCnyCircleFill",
          is_active: false,
        },
        {
          title: t("api_keys.title"),
          url: "/api-keys",
          icon: "RiKey2Line",
          is_active: false,
        },
        {
          title: "Notifications",
          url: "/notifications",
          icon: "RiNotification3Line",
          is_active: false,
        },
        {
          title: "Usage",
          url: "/usage",
          icon: "RiLineChartLine",
          is_active: false,
        },
        {
          title: "Settings",
          url: "/settings",
          icon: "RiSettingsLine",
          is_active: false,
        },
      ],
    },
  };

  return <ConsoleLayout sidebar={sidebar}>{children}</ConsoleLayout>;
}
