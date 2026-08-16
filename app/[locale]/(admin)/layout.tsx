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
          title: "Dashboard",
          url: "/admin",
          icon: "RiDashboardLine",
        },
        {
          title: "Users",
          url: "/admin/users",
          icon: "RiUserLine",
        },
        {
          title: "Orders",
          icon: "RiOrderPlayLine",
          is_expand: true,
          children: [
            {
              title: "Paid Orders",
              url: "/admin/paid-orders",
            },
          ],
        },
        {
          title: "Credits",
          url: "/admin/credits",
          icon: "RiCoinsLine",
        },
        {
          title: "Audit Logs",
          url: "/admin/audit-logs",
          icon: "RiFileList3Line",
        },
        {
          title: "Posts",
          url: "/admin/posts",
          icon: "RiArticleLine",
        },
      ],
    },
    social: {
      items: [
        {
          title: "Home",
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
