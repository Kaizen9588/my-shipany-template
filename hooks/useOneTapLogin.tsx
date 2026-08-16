"use client";

import googleOneTap from "google-one-tap";
import { signIn } from "next-auth/react";
import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Google One-Tap 登录 Hook（6.4）
 *
 * 注意：Hook 必须无条件调用（rules-of-hooks）。
 * 是否启用由 useEffect 内部根据环境变量判断，组件外无条件调用即可。
 */
export default function useOneTapLogin() {
  const { data: session, status } = useSession();

  const oneTapLogin = async function () {
    const options = {
      client_id: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ID,
      auto_select: false,
      cancel_on_tap_outside: false,
      context: "signin",
    };

    googleOneTap(options, (response: any) => {
      console.log("onetap login ok", response);
      handleLogin(response.credential);
    });
  };

  const handleLogin = async function (credentials: string) {
    const res = await signIn("google-one-tap", {
      credential: credentials,
      redirect: false,
    });
    console.log("signIn ok", res);
  };

  useEffect(() => {
    const enabled =
      process.env.NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED === "true" &&
      Boolean(process.env.NEXT_PUBLIC_AUTH_GOOGLE_ID);

    if (!enabled) {
      return;
    }

    if (status === "unauthenticated") {
      oneTapLogin();

      const intervalId = setInterval(() => {
        oneTapLogin();
      }, 3000);

      return () => {
        clearInterval(intervalId);
      };
    }
  }, [status]);

  return <></>;
}
