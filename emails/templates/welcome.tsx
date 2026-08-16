import { Text } from "@react-email/components";
import EmailLayout from "../layout";

export interface TemplateVariables {
  variables: Record<string, string | number>;
}

/** 新用户注册（OAuth 首次登录） */
export default function WelcomeEmail({ variables }: TemplateVariables) {
  const nickname = String(variables.nickname || "");
  const credits = variables.credits || 10;

  return (
    <EmailLayout preview="Welcome!" title="Welcome aboard! 🎉">
      <Text>Hi {nickname || "there"},</Text>
      <Text>
        Thanks for signing up! We&apos;ve added{" "}
        <strong>{credits} credits</strong> to your account (valid for 1 year).
      </Text>
      <Text>Start exploring and building your AI SaaS today.</Text>
    </EmailLayout>
  );
}
