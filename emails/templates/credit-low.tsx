import { Text } from "@react-email/components";
import EmailLayout from "../layout";
import { TemplateVariables } from "./welcome";

/** 积分低于阈值提醒 */
export default function CreditLowEmail({ variables }: TemplateVariables) {
  const left = variables.left_credits || 0;
  const threshold = variables.threshold || 10;

  return (
    <EmailLayout preview="Credits running low" title="Credits running low ⚠️">
      <Text>
        You have <strong>{left} credits</strong> left (below {threshold}).
      </Text>
      <Text>
        Top up now to keep your AI features running without interruption.
      </Text>
    </EmailLayout>
  );
}
