/**
 * API 测试 globalSetup：库重置（truncate + GRANT + seed）在起 dev server 之前完成。
 * Playwright 会先跑本文件再拉 webServer。
 */
export default async function globalSetup() {
  const { main } = await import("./db-lifecycle");
  await main();
}
