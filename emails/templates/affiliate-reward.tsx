import { Text } from "@react-email/components";
import EmailLayout from "../layout";
import { TemplateVariables } from "./welcome";

/** 联盟奖励到账提醒（迁移 0036：奖励自动转积分，docs/05 §3.4 方案 A） */
export default function AffiliateRewardEmail({ variables }: TemplateVariables) {
  const credits = variables.credits || 0;
  const total = variables.total_credits || 0;

  return (
    <EmailLayout preview="You earned a referral reward" title="Referral reward received 🎉">
      <Text>
        Great news! One of your invited friends made their first purchase, and
        you earned <strong>{credits} credits</strong> as a referral reward.
      </Text>
      <Text>
        The reward credits never expire and are ready to use. Your total reward
        balance so far: <strong>{total} credits</strong>.
      </Text>
      <Text>
        Keep sharing your invite link to earn more!
      </Text>
    </EmailLayout>
  );
}
