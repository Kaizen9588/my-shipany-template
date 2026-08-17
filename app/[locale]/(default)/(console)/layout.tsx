import ConsoleLayout from "@/components/console/layout";
import { ReactNode } from "react";
import { Sidebar } from "@/types/blocks/sidebar";
import { getTranslations } from "next-intl/server";
import { getUserInfo } from "@/services/user";
import { redirect } from "next/navigation";

export default async function ({ children }: { children: ReactNode }) {
  const userInfo = await getUserInfo();
  if (!userInfo || !userInfo.email) {
    redirect("/auth/signin");
  }

  // 默认管理员首次登录强制改密（0012_default_admin.sql）
  if (userInfo.must_change_password) {
    redirect("/change-password");
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
