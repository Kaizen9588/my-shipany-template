import { Text } from "@react-email/components";
import EmailLayout from "../layout";
import { TemplateVariables } from "./welcome";

/** 邮箱验证码（注册验证 / 密码重置，6.4） */
export default function VerificationCodeEmail({
  variables,
}: TemplateVariables) {
  const code = String(variables.code || "");
  const purpose = String(variables.purpose || "register");

  return (
    <EmailLayout
      preview="Your verification code"
      title={
        purpose === "reset"
          ? "Reset your password"
          : "Verify your email"
      }
    >
      <Text>Your verification code is:</Text>
      <Text
        style={{
          fontSize: "28px",
          fontWeight: "bold",
          letterSpacing: "4px",
          textAlign: "center",
          margin: "16px 0",
        }}
      >
        {code}
      </Text>
      <Text>The code expires in 10 minutes. If you didn&apos;t request this, ignore this email.</Text>
    </EmailLayout>
  );
}
