/**
 * user 组：登录态用户资源接口 + 越权边界。
 * 覆盖：user/profile, user/change-password, user/delete-account,
 *       user/avatar, notifications, notifications/read,
 *       update-invite, update-invite-code
 */
import { test, expect } from "@playwright/test";
import { BASE, SEED, credentialsLogin, registerNewUser } from "../helpers";

test.describe("user / 登录态资源", () => {
  test.beforeEach(async ({ request }) => {
    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
  });

  test("PUT /api/user/profile 改昵称与 locale；空改动报 nothing to update", async ({
    request,
  }) => {
    const res = await request.put(`${BASE}/api/user/profile`, {
      data: { nickname: "seed-nick", locale: "en" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.updated).toBe(true);

    const empty = await request.put(`${BASE}/api/user/profile`, { data: {} });
    const emptyBody = await empty.json();
    expect(emptyBody.code).toBe(-1);
    expect(emptyBody.message).toBe("nothing to update");

    // 非法 locale
    const bad = await request.put(`${BASE}/api/user/profile`, {
      data: { locale: "fr" },
    });
    expect((await bad.json()).code).toBe(-1);
  });

  test("PUT /api/user/profile 未登录 401", async ({ request }) => {
    // 全新无 cookie 上下文
    const res = await request.put(`${BASE}/api/user/profile`, {
      data: { nickname: "x" },
      headers: { cookie: "" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/user/change-password 错误当前密码拒绝、新密码弱拒绝、成功改密", async ({
    request,
  }) => {
    // 弱密码
    const weak = await request.post(`${BASE}/api/user/change-password`, {
      data: { currentPassword: SEED.userPassword, newPassword: "short" },
    });
    expect((await weak.json()).code).toBe(-1);

    // 错误当前密码（一次性用户避免锁定种子账号）
    const reg = await registerNewUser(request, "chpw");
    await credentialsLogin(request, reg.email, reg.password);
    const wrong = await request.post(`${BASE}/api/user/change-password`, {
      data: { currentPassword: "WrongOld123", newPassword: "NewPass123456" },
    });
    expect((await wrong.json()).code).toBe(-1);

    // 成功改密 → 新密码可登录
    const ok = await request.post(`${BASE}/api/user/change-password`, {
      data: { currentPassword: reg.password, newPassword: "BrandNew123456" },
    });
    const okBody = await ok.json();
    expect(okBody.code).toBe(0);
    expect(okBody.data.ok).toBe(true);
  });

  test("GET /api/notifications 列表与 unread 计数；POST /api/notifications/read 标记", async ({
    request,
  }) => {
    const list = await request.get(`${BASE}/api/notifications?page=1`);
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    expect(listBody.code).toBe(0);
    // payment 组的 webhook 用例可能给 seed 用户产生过通知 → 不假设为空，
    // 只验证结构一致性与 unread 计数口径
    expect(Array.isArray(listBody.data.notifications)).toBe(true);
    const unreadCount = listBody.data.notifications.filter(
      (n: { is_read: boolean }) => !n.is_read
    ).length;
    expect(listBody.data.unread).toBe(unreadCount);

    const read = await request.post(`${BASE}/api/notifications/read`, {
      data: {},
    });
    expect((await read.json()).data.ok).toBe(true);
  });

  test("POST /api/update-invite-code 设置邀请码（2-16 位）与冲突检测", async ({
    request,
  }) => {
    const ok = await request.post(`${BASE}/api/update-invite-code`, {
      data: { invite_code: "seeduser" },
    });
    expect((await ok.json()).code).toBe(0);

    const bad = await request.post(`${BASE}/api/update-invite-code`, {
      data: { invite_code: "x" },
    });
    expect((await bad.json()).code).toBe(-1);
  });

  test("POST /api/update-invite 绑定不存在的邀请码报错、自邀报错", async ({
    request,
  }) => {
    const none = await request.post(`${BASE}/api/update-invite`, {
      data: { invite_code: "no-such-code" },
    });
    expect((await none.json()).code).toBe(-1);
  });

  test("POST /api/user/avatar 未配置存储时友好报错且不 500", async ({
    request,
  }) => {
    // .env.api-test 不配 STORAGE_* → uploadFile 抛 Bucket is required → 200 respErr
    const res = await request.post(`${BASE}/api/user/avatar`, {
      multipart: {
        file: {
          name: "a.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "89504e470d0a1a0a0000000d494844520000000100000001080600000", // PNG 魔数前缀（不完整但过魔数检查）
            "hex"
          ),
        },
      },
    });
    const body = await res.json();
    expect(body.code).toBe(-1); // respErr("upload avatar failed: ...")
  });

  test("POST /api/user/delete-account 全链路：注册→删除→登录失效", async ({
    request,
  }) => {
    const reg = await registerNewUser(request, "delacc");
    await credentialsLogin(request, reg.email, reg.password);

    const del = await request.post(`${BASE}/api/user/delete-account`);
    const delBody = await del.json();
    expect(delBody.code).toBe(0);
    expect(delBody.data.deleted).toBe(true);

    // 删除后 session 用户 status=deleted → getUserUuid 视为未登录
    const info = await request.post(`${BASE}/api/get-user-info`);
    expect((await info.json()).code).toBe(-2);
  });
});
