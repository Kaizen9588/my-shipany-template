/**
 * cron 组：/api/cron/daily 的 Bearer 鉴权与执行。
 * dev 下未配 CRON_SECRET 时放行——本环境配了 secret，全部走鉴权路径。
 */
import { test, expect } from "@playwright/test";
import { BASE } from "../helpers";

test.describe("cron / 定时任务", () => {
  test("无 Bearer → 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/cron/daily`, {
      headers: { cookie: "" },
    });
    expect(res.status()).toBe(401);
  });

  test("错误 secret → 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/cron/daily`, {
      headers: { Authorization: "Bearer wrong-cron-secret" },
    });
    expect(res.status()).toBe(401);
  });

  test("正确 secret → 200 且执行任务汇总（backup 未配存储时安全跳过）", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/cron/daily`, {
      headers: { Authorization: "Bearer cron_api_test_secret" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});
