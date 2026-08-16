import { Text } from "@react-email/components";
import EmailLayout from "../layout";
import { TemplateVariables } from "./welcome";

/** 积分耗尽提醒 */
export default function CreditExhaustedEmail({
  variables,
}: TemplateVariables) {
  const topupUrl = String(
    variables.topup_url ||
      `${process.env.NEXT_PUBLIC_WEB_URL || ""}/#pricing`
  );

  return (
    <EmailLayout preview="Credits exhausted" title="Your credits are used up">
      <Text>
        You&apos;ve used all your credits. Recharge to continue using AI
        features.
      </Text>
      <Text>
        <a href={topupUrl}>{topupUrl}</a>
      </Text>
    </EmailLayout>
  );
}
