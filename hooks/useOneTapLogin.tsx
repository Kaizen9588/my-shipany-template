"use client";

import { useEffect } from "react";

import { useSession, signIn } from "next-auth/react";

/**
 * Google One-Tap 登录 Hook（6.4）
 *
 * 直接对接 Google Identity Services（accounts.google.com/gsi/client），
 * 不再依赖 google-one-tap@1.0.6：该包每次调用都向 head 注入一份 GIS 脚本、
 * 且把 prompt() 挂在 window.onload 上（水合时早已触发，prompt 永不执行）。
 *
 * 行为约定：
 * - 仅未登录时提示一次（session 就绪后），登录成功刷新页面换新会话
 * - prompt 被用户关闭/被 Google 跳过（not_displayed）时按 Google 规则
 *   进入冷却（同域 24h 内不再弹），不做轮询重试（旧实现 3s setInterval
 *   会脚本刷屏 + 触发 Google 提示频控）
 * - Hook 必须无条件调用（rules-of-hooks）；是否启用由内部根据环境变量判断
 */

// GIS 脚本全局只注入一次（StrictMode 双调用 / 多组件复用安全）
const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if ((window as any).google?.accounts?.id) {
    return Promise.resolve();
  }
  if (!gisLoadPromise) {
    gisLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoadPromise = null;
        reject(new Error("failed to load Google Identity Services"));
      };
      document.head.appendChild(script);
    });
  }
  return gisLoadPromise;
}

export default function useOneTapLogin() {
  const { status } = useSession();

  useEffect(() => {
    const enabled =
      process.env.NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED === "true" &&
      Boolean(process.env.NEXT_PUBLIC_AUTH_GOOGLE_ID);

    if (!enabled || status !== "unauthenticated") {
      return;
    }

    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled) {
          return;
        }
        const google = (window as any).google;
        if (!google?.accounts?.id) {
          return;
        }

        google.accounts.id.initialize({
          client_id: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ID,
          auto_select: false,
          cancel_on_tap_outside: true,
          context: "signin",
          callback: (response: { credential?: string }) => {
            if (!response?.credential) {
              return;
            }
            signIn("google-one-tap", {
              credential: response.credential,
              redirect: false,
            }).then((res) => {
              if (res?.error) {
                console.log("one tap signIn failed: ", res.error);
                return;
              }
              // 换新会话：整页刷新让 RSC 侧（导航/用户态）同步
              window.location.reload();
            });
          },
        });
        google.accounts.id.prompt((notification: any) => {
          // 弹不出来时（无效 client / 同域 24h 冷却 / 第三方 cookie 拦截）
          // 留一条可排查的日志
          if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
            console.log(
              "one tap prompt not displayed:",
              notification.getNotDisplayedReason?.() ||
                notification.getSkippedReason?.()
            );
          }
        });
      })
      .catch((e) => {
        console.log("one tap init failed: ", e);
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return null;
}
