export const locales = ["en", "zh"];

export const localeNames: any = {
  en: "English",
  zh: "中文",
};

export const defaultLocale = "en";

export const localePrefix = "as-needed";

export const localeDetection =
  process.env.NEXT_PUBLIC_LOCALE_DETECTION === "true";

// 说明：项目未使用 next-intl 的 pathnames 路由翻译（legal 页在 app/(legal)/ 根下，
// 不参与 [locale] 路由），因此不配置 pathnames——所有字符串 href 按普通路径加语言前缀。
