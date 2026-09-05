"use client";

import { useLinkStatus } from "next/link";

/**
 * 导航点击瞬间的顶部进度条（Next 16 useLinkStatus）。
 * loading.tsx 只能覆盖 URL 已更新之后的阶段；dev/弱网下点击到路由
 * 开始响应之间有数百毫秒~数秒空窗，旧页面原地不动，用户感知"点了没反应"。
 * 本组件必须渲染在 <Link> 内部，pending 期间显示固定定位进度条。
 */
export default function PendingBar() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      className={
        "fixed inset-x-0 top-0 z-[100] h-0.5 bg-primary pointer-events-none " +
        (pending
          ? "animate-in fade-in slide-in-from-left-4 duration-200 navigation-progress-pulse"
          : "invisible opacity-0")
      }
    />
  );
}
