import { redirect } from "next/navigation";
import { getUserInfo } from "@/services/user";
import ChangePasswordForm from "./change-password-form";

/**
 * 修改密码页（默认管理员首次登录强制改密）
 * 未登录直接跳登录页；提交后由客户端调用 /api/user/change-password。
 */
export default async function ChangePasswordPage() {
  const user = await getUserInfo();
  if (!user) {
    redirect("/auth/signin");
  }

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-4">
      <div className="w-full space-y-4 rounded-xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Change your password</h1>
        <p className="text-sm text-muted-foreground">
          你正在使用首次登录的默认密码。出于安全考虑，请先设置一个新密码，
          然后再继续使用后台与控制台。
        </p>
        <ChangePasswordForm email={user.email} />
      </div>
    </main>
  );
}
