import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

const { Link, redirect: intlRedirect, usePathname, useRouter } =
  createNavigation(routing);

export { Link, usePathname, useRouter };

/**
 * 服务端跳转。显式声明返回 never：createNavigation 解构出的 redirect 是推断类型，
 * TS 不将其识别为 never-returning 函数，`if (!x) redirect(...)` 之后的控制流收窄会失效。
 */
export function redirect(args: { href: string; locale: string }): never {
  return intlRedirect(args);
}
