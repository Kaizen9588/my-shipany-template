"use client";

import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Link } from "@/i18n/navigation";
import { User } from "@/types/user";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

export default function SignUser({ user }: { user: User }) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="cursor-pointer">
          <AvatarImage src={user.avatar_url} alt={user.nickname} />
          {/* 无自定义头像时显示默认头像图（与用户中心设置页一致），不显示昵称文字 */}
          <AvatarFallback>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt={user.nickname} className="h-full w-full object-cover" />
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="mx-4">
        <DropdownMenuLabel className="text-center truncate">
          {user.nickname}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* asChild：item 整体变成 Link，点菜单项任意位置都能跳转；
            此前 Link 嵌在 item 内部，点边缘只关菜单不跳转，看起来“没反应” */}
        <DropdownMenuItem asChild className="flex justify-center cursor-pointer">
          <Link href="/my-orders">{t("user.user_center")}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="flex justify-center cursor-pointer">
          <Link href="/admin/users" target="_blank">
            {t("user.admin_system")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="flex justify-center cursor-pointer"
          onClick={() => signOut()}
        >
          {t("user.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
