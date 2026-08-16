import "@/app/globals.css";

import { getMessages, getTranslations } from "next-intl/server";

import { AppContextProvider } from "@/contexts/app";
import CrispWidget from "@/components/feedback/crisp";
import CookieConsent from "@/components/cookie-consent";
import { Inter as FontSans } from "next/font/google";
import { Metadata } from "next";
import { NextAuthSessionProvider } from "@/auth/session";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "@/providers/theme";
import { cn } from "@/lib/utils";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations();

  const siteUrl = process.env.NEXT_PUBLIC_WEB_URL || "https://example.com";

  return {
    metadataBase: new URL(siteUrl),
    title: {
      template: `%s | ${t("metadata.title")}`,
      default: t("metadata.title") || "",
    },
    description: t("metadata.description") || "",
    keywords: t("metadata.keywords") || "",
    openGraph: {
      title: t("metadata.title") || "",
      description: t("metadata.description") || "",
      url: siteUrl,
      siteName: t("metadata.title") || "",
      type: "website",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      images: [{ url: `${siteUrl}/preview.png`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: t("metadata.title") || "",
      description: t("metadata.description") || "",
      images: [`${siteUrl}/preview.png`],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased overflow-x-hidden",
          fontSans.variable
        )}
      >
        <NextIntlClientProvider messages={messages}>
          <NextAuthSessionProvider>
            <AppContextProvider>
              <ThemeProvider attribute="class" disableTransitionOnChange>
                {children}
              </ThemeProvider>
              <CookieConsent />
              <CrispWidget />
            </AppContextProvider>
          </NextAuthSessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
