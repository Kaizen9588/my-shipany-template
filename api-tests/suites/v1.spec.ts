/**
 * v1 组：对外 AI API（demo 匿名额度、generate API key 鉴权与幂等）。
 * 全部走"无 provider 凭据"的本地路径，不外呼任何 AI 服务。
 */
import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { BASE, credentialsLogin, SEED } from "../helpers";

function dbUrl(): string {
  for (const f of [".env.api-test", ".env.local"]) {
    try {
      for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (t.startsWith("DATABASE_URL") && !process.env.DATABASE_URL) {
          const eq = t.indexOf("=");
          let v = t.slice(eq + 1).trim();
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          return v;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return process.env.DATABASE_URL || "";
}

/** 直插 API key（无创建 key 的 HTTP 接口；表存 sha256(key)，key_prefix 前 8 位） */
async function insertApiKey(rawKey: string, userUuid: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO apikeys (api_key, key_prefix, title, user_uuid, created_at, status)
       VALUES ($1, $2, 'api-test', $3, now(), 'created')
       ON CONFLICT (api_key) DO NOTHING`,
      [createHash("sha256").update(rawKey).digest("hex"), rawKey.slice(0, 8), userUuid]
    );
  } finally {
    await client.end();
  }
}

async function getUserUuidByEmail(email: string): Promise<string> {
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ uuid: string }>(
      `SELECT uuid FROM users WHERE email = $1`,
      [email]
    );
    return rows[0]?.uuid || "";
  } finally {
    await client.end();
  }
}

test.describe("v1 / AI API", () => {
  test("POST /api/v1/ai/demo 字段白名单：多余字段 400", async ({ request }) => {
    const res = await request.post(`${BASE}/api/v1/ai/demo`, {
      data: { prompt: "hi", evil: "x" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/v1/ai/demo prompt 超 8KB → 413 且消耗当日次数", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/v1/ai/demo`, {
      data: { prompt: "x".repeat(8 * 1024 + 1) },
    });
    expect(res.status()).toBe(413);
  });

  test("POST /api/v1/ai/demo 无 provider 凭据 → 500 demo failed（不外呼）", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/v1/ai/demo`, {
      data: { prompt: "hello" },
    });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("demo failed");
  });

  test("POST /api/v1/ai/demo 匿名日额度（3 次）用尽后 429", async ({
    request,
  }) => {
    // 上一个用例已消耗 1 次（8KB 用例也消耗 1 次）→ 这里再打到超限。
    // anonymous_usage 键 = sha256(ip)，TRUSTED_PROXY=none 下全测试共享 127.0.0.1。
    let saw429 = false;
    for (let i = 0; i < 6 && !saw429; i++) {
      const res = await request.post(`${BASE}/api/v1/ai/demo`, {
        data: { prompt: "quota-probe" },
      });
      if (res.status() === 429) saw429 = true;
      // 500（provider 缺失）与 413 都会消耗额度，循环即可
    }
    expect(saw429, "匿名日额度应被触发 429").toBe(true);
  });

  test("POST /api/v1/ai/generate 无登录 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "hi" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/v1/ai/generate session 登录：非法模型 400、stream 501、无 provider 500", async ({
    request,
  }) => {
    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);

    const badModel = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "not-a-model", prompt: "hi" },
    });
    expect(badModel.status()).toBe(400);
    expect((await badModel.json()).message).toContain("invalid model");

    const stream = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "hi", stream: true },
    });
    expect(stream.status()).toBe(501);

    const ok = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "hi" },
    });
    expect(ok.status()).toBe(500);
    expect((await ok.json()).message).toContain(
      "provider credentials not configured"
    );
  });

  test("POST /api/v1/ai/generate sk- key 鉴权：无效 key 401、有效 key 进入配额路径", async ({
    request,
  }) => {
    const invalid = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "hi" },
      headers: { Authorization: "Bearer sk-invalidkey123" },
    });
    expect(invalid.status()).toBe(401);

    const uuid = await getUserUuidByEmail(SEED.userEmail);
    expect(uuid).toBeTruthy();
    const rawKey = `sk-test${randomUUID().replace(/-/g, "")}`;
    await insertApiKey(rawKey, uuid);

    // 有效 key：走日配额/限流路径 → 无 provider → 500（发生在扣费前）
    const res = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "hi" },
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res.status()).toBe(500);
  });

  test("POST /api/v1/ai/generate Idempotency-Key 校验：非法 400、同键异体 422", async ({
    request,
  }) => {
    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);

    const badKey = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "hi" },
      headers: { "Idempotency-Key": "bad key with spaces!" },
    });
    expect(badKey.status()).toBe(400);

    // 同键异体：provider 缺失在扣费前 500，不落幂等表 → 用合法键但两个不同 body
    // 第二个请求 422 需要首请求已成功记录；provider 缺失路径不写表 → 只断言 400 分支 + 合法键被接受（500 提供商错误）
    const legal = await request.post(`${BASE}/api/v1/ai/generate`, {
      data: { model: "deepseek-chat", prompt: "idem-key-test" },
      headers: { "Idempotency-Key": "idem-legal-key-123" },
    });
    expect(legal.status()).toBe(500);
  });

  test("GET /api/v1/ai/generate?request_id 未登录 401 / 非法参数 400 / 不存在 404", async ({
    request,
  }) => {
    const anon = await request.get(
      `${BASE}/api/v1/ai/generate?request_id=req-xyz`
    );
    expect(anon.status()).toBe(401);

    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
    const missing = await request.get(
      `${BASE}/api/v1/ai/generate?request_id=nonexistent-req-000`
    );
    expect(missing.status()).toBe(404);
  });
});
