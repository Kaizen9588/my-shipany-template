"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Crisp 反馈/客服按钮（6.3）
 *
 * 右下角浮动在线沟通。NEXT_PUBLIC_CRISP_WEBSITE_ID 为空时不加载。
 * 登录用户自动传递 email / nickname 给 Crisp（进阶）。
 */
export default function CrispWidget() {
  const { data: session } = useSession();

  useEffect(() => {
    const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
    if (!websiteId) {
      return;
    }

    const w = window as any;
    w.$crisp = [];
    w.CRISP_WEBSITE_ID = websiteId;

    const d = document;
    const s = d.createElement("script");
    s.src = "https://client.crisp.chat/l.js";
    s.async = true;
    d.getElementsByTagName("head")[0].appendChild(s);
  }, []);

  useEffect(() => {
    const user = session?.user;
    if (!user || !user.email) {
      return;
    }
    const w = window as any;
    if (!w.$crisp) {
      return;
    }
    w.$crisp.push(["set", "user:email", user.email]);
    if (user.name) {
      w.$crisp.push(["set", "user:nickname", user.name]);
    }
  }, [session]);

  return null;
}
