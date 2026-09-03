import Footer from "@/components/blocks/footer";
import Header from "@/components/blocks/header";
import { ReactNode } from "react";
import { getLandingPage } from "@/services/page";
import { getUserInfo } from "@/services/user";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

export default async function DefaultLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const page = await getLandingPage(locale);

  // 默认管理员首次登录强制改密（0027）：登录落点不再硬编码首页，
  // 这里兜底拦截，未完成改密前不允许浏览站点页面
  const userInfo = await getUserInfo();
  if (userInfo?.must_change_password) {
    redirect({ href: "/change-password", locale });
  }

  return (
    <>
      {page.header && <Header header={page.header} />}
      <main className="overflow-x-hidden">{children}</main>
      {page.footer && <Footer footer={page.footer} />}
    </>
  );
}
