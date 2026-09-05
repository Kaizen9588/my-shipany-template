"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { signIn } from "next-auth/react";
import { TelemetryEvents, track } from "@/lib/telemetry";
import { useAppContext } from "@/contexts/app";

/**
 * 邮箱密码登录 / 注册表单（6.4）
 * - 登录：邮箱 + 密码 → NextAuth Credentials Provider
 * - 注册：邮箱 → 发送验证码 → 验证码 + 密码 → /api/verify-code → 自动登录
 */

/**
 * 登录成功后的落点：
 * - 会话带 must_change_password（默认管理员首次登录）→ 强制改密页
 * - 其余 → 首页（callbackUrl 场景由 signin 服务端页处理）
 */
async function resolvePostSignInTarget(): Promise<string> {
  try {
    const resp = await fetch("/api/get-user-info", { method: "POST" });
    const { code, data } = await resp.json();
    if (code === 0 && data?.must_change_password) {
      return "/change-password";
    }
  } catch {
    // 查询失败不阻塞登录，落首页
  }
  return "/";
}

export default function EmailSignForm() {
  const router = useRouter();
  const { setShowSignModal } = useAppContext();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"form" | "verify">("form");
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error("invalid email");
      return;
    }
    track({
      name: TelemetryEvents.SignupStarted,
      properties: { provider: "email" },
    });
    setLoading(true);
    try {
      const resp = await fetch("/api/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "register" }),
      });
      const { code: resCode, message } = await resp.json();
      if (resCode !== 0) {
        toast.error(message || "send code failed");
        return;
      }
      setStep("verify");
      toast.success("Verification code sent");
    } catch (e) {
      toast.error("send code failed");
    } finally {
      setLoading(false);
    }
  };

  const verifyAndRegister = async () => {
    if (!code || !password) {
      toast.error("code and password are required");
      return;
    }
    if (
      password.length < 8 ||
      !/[a-zA-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      toast.error("password must be at least 8 chars with letters and numbers");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password, mode: "register" }),
      });
      const { code: resCode, message } = await resp.json();
      if (resCode !== 0) {
        toast.error(message || "verify failed");
        return;
      }
      await signIn("credentials", { email, password, redirect: false });
      track({
        name: TelemetryEvents.SignupCompleted,
        properties: { provider: "email" },
      });
      setShowSignModal(false);
      router.push(await resolvePostSignInTarget());
      router.refresh();
    } catch (e) {
      toast.error("verify failed");
    } finally {
      setLoading(false);
    }
  };

  const signInWithPassword = async () => {
    if (!email || !password) {
      toast.error("email and password are required");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        toast.error("invalid email or password");
        return;
      }
      setShowSignModal(false);
      router.push(await resolvePostSignInTarget());
      router.refresh();
    } catch (e) {
      toast.error("sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "signin" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setMode("signin");
            setStep("form");
          }}
        >
          Sign in
        </Button>
        <Button
          type="button"
          variant={mode === "signup" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setMode("signup");
            setStep("form");
          }}
        >
          Sign up
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="m@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>

      {mode === "signup" && step === "verify" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="at least 8 chars, letters + numbers"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button className="w-full" onClick={verifyAndRegister} disabled={loading}>
            {loading ? "Verifying..." : "Verify & Create Account"}
          </Button>
        </>
      ) : mode === "signup" ? (
        <Button className="w-full" onClick={sendCode} disabled={loading}>
          {loading ? "Sending..." : "Send Verification Code"}
        </Button>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button className="w-full" onClick={signInWithPassword} disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </>
      )}
    </div>
  );
}
