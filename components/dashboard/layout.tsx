import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { ReactNode } from "react";
import Sidebar from "@/components/dashboard/sidebar";
import { Sidebar as SidebarType } from "@/types/blocks/sidebar";

export default async function DashboardLayout({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar?: SidebarType;
}) {
  return (
    <SidebarProvider>
      {sidebar && <Sidebar sidebar={sidebar} />}
      {/* p-6：内容区与侧栏/边缘留出间隔，避免正文紧贴菜单栏 */}
      <SidebarInset className="p-6">{children}</SidebarInset>
    </SidebarProvider>
  );
}
