import type { MetadataRoute } from "next";

/**
 * 动态 Sitemap（专业 SaaS 模板）
 * 使用 NEXT_PUBLIC_WEB_URL 作为站点根，支持多语言 URL。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_WEB_URL || "https://example.com";
  const now = new Date();

  const routes = [
    "",
    "/en",
    "/zh",
    "/en/posts",
    "/zh/posts",
    "/en/auth/signin",
    "/zh/auth/signin",
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: route === "" ? 1 : 0.8,
  }));
}
