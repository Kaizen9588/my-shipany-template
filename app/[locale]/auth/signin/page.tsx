import SignForm from "@/components/sign/form";
import { auth } from "@/auth";
import { Link, redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { findUserByUuid } from "@/models/user";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl: string | undefined }>;
}) {
  const { callbackUrl } = await searchParams;
  const session = await auth();
  if (session?.user?.uuid) {
    // 默认管理员首次登录（must_change_password）必须能进入改密流程：
    // 若此处一律 redirect 首页，改密前登录页会变成死循环出口
    const user = await findUserByUuid(session.user.uuid);
    // 只接受站内相对路径，防开放重定向（callbackUrl 可被外部拼到 query 上）
    const safeCallback =
      callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
        ? callbackUrl
        : "/";
    const target =
      user?.must_change_password && safeCallback !== "/change-password"
        ? "/change-password"
        : safeCallback;
    return redirect({ href: target, locale: await getLocale() });
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link
          href="/"
          className="flex items-center gap-2 self-center font-medium"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md border text-primary-foreground">
            <img src="/logo.png" alt="logo" className="size-4" />
          </div>
          {process.env.NEXT_PUBLIC_PROJECT_NAME}
        </Link>
        <SignForm />
      </div>
    </div>
  );
}
