/**
 * React Email 统一邮件布局（docs/10 §3.1）
 * 品牌 + 产品 URL + 事务性邮件说明（事务性不可退订；营销类需单独放退订链接）。
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export default function EmailLayout({
  preview,
  title,
  children,
}: {
  preview?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const projectName = process.env.NEXT_PUBLIC_PROJECT_NAME || "ShipAny";
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL || "https://example.com";

  return (
    <Html>
      <Head />
      {preview ? <Preview>{preview}</Preview> : null}
      <Body style={{ fontFamily: "sans-serif", padding: "24px" }}>
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "24px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
          }}
        >
          {title ? (
            <Heading style={{ fontSize: "20px", marginTop: "0" }}>
              {title}
            </Heading>
          ) : null}
          <Section>{children}</Section>
          <Hr style={{ margin: "24px 0" }} />
          <Text style={{ color: "#6b7280", fontSize: "12px" }}>
            {projectName} · {webUrl}
          </Text>
          <Text style={{ color: "#9ca3af", fontSize: "12px" }}>
            此邮件为账户通知邮件，无法退订。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
