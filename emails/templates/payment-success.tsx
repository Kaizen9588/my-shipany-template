import { Text } from "@react-email/components";
import EmailLayout from "../layout";
import { TemplateVariables } from "./welcome";

/** 支付成功（积分充值） */
export default function PaymentSuccessEmail({
  variables,
}: TemplateVariables) {
  const productName = String(variables.product_name || "Credits");
  const credits = variables.credits || 0;
  const orderNo = String(variables.order_no || "");

  return (
    <EmailLayout preview="Payment received" title="Payment received ✅">
      <Text>Your payment was successful!</Text>
      <Text>
        <strong>{credits} credits</strong> have been added to your account (
        {productName}).
      </Text>
      {orderNo ? <Text>Order No: {orderNo}</Text> : null}
      <Text>Happy building!</Text>
    </EmailLayout>
  );
}
