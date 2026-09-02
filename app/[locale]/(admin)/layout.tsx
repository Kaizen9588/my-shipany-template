import DashboardLayout from "@/components/dashboard/layout";
import Empty from "@/components/blocks/empty";
import { ReactNode } from "react";
import { Sidebar } from "@/types/blocks/sidebar";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // 6.10 RBAC：super_admin / admin / operator（ADMIN_EMAILS 白名单过渡保留）
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/auth/signin");
  }

  // 默认管理员首次登录/未改密时，先完成改密再进入后台
  if (admin.must_change_password) {
    redirect("/change-password");
  }

  const sidebar: Sidebar = {
    brand: {
      title: "ShipAny",
      logo: {
        src: "/logo.png",
        alt: "ShipAny",
      },
      url: "/admin",
    },
    nav: {
      items: [
        {
          title: "控制台",
          url: "/admin",
          icon: "RiDashboardLine",
        },
        {
          title: "用户管理",
          url: "/admin/users",
          icon: "RiUserLine",
        },
        {
          title: "订单",
          icon: "RiOrderPlayLine",
          is_expand: true,
          children: [
            {
              title: "已支付订单",
              url: "/admin/paid-orders",
            },
            {
              title: "回收工作台",
              url: "/admin/recovery",
            },
          ],
        },
        {
          title: "积分管理",
          url: "/admin/credits",
          icon: "RiCoinsLine",
        },
        {
          title: "审批队列",
          url: "/admin/approvals",
          icon: "RiShieldCheckLine",
        },
        {
          title: "操作审计",
          url: "/admin/audit-logs",
          icon: "RiFileList3Line",
        },
          {
            title: "支付渠道",
            url: "/admin/payment",
            icon: "RiBankCardLine",
          },
          {
            title: "定价映射",
            url: "/admin/pricing",
            icon: "RiPriceTag3Line",
          },
          {
            title: "告警通知",
            url: "/admin/notify",
            icon: "RiNotification3Line",
          },
          {
            title: "运营日志",
            url: "/admin/logs",
            icon: "RiFileList3Line",
          },
        {
          title: "文章管理",
          url: "/admin/posts",
          icon: "RiArticleLine",
        },
      ],
    },
    social: {
      items: [
        {
          title: "前台首页",
          url: "/",
          target: "_blank",
          icon: "RiHomeLine",
        },
        {
          title: "Github",
          url: "https://github.com/Kaizen9588/my-shipany-template",
          target: "_blank",
          icon: "RiGithubLine",
        },
      ],
    },
  };

  return <DashboardLayout sidebar={sidebar}>{children}</DashboardLayout>;
}
