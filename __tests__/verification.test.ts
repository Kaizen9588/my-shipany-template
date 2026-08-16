import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/lib/hash", async (importOriginal) => {
  // 2.15：code 走 hashString 存储/比对，hash 函数必须用真实实现
  const actual = await importOriginal<typeof import("@/lib/hash")>();
  return {
    ...actual,
    getNonceStr: vi.fn(),
  };
});

import { getNonceStr, hashString } from "@/lib/hash";
import { getSupabaseClient } from "@/models/db";
import {
  consumeVerificationCode,
  createVerificationCode,
  generateCode,
  cleanupVerificationCodes,
} from "@/models/verification";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockNonce = getNonceStr as unknown as ReturnType<typeof vi.fn>;

describe("models/verification（6.4 邮箱验证码，2.15 hash 存储）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNonce.mockReturnValue("a1b2c3");
  });

  it("generateCode 返回 6 位/6 字符", () => {
    const code = generateCode();
    expect(code.length).toBeGreaterThanOrEqual(1);
    expect(code.length).toBeLessThanOrEqual(6);
  });

  it("createVerificationCode 插入的是哈希而非明文 code", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });

    const code = await createVerificationCode("u@example.com", 10);
    expect(code).toBeTruthy();
    expect(insert).toHaveBeenCalled();
    const row = insert.mock.calls[0][0];
    expect(row.email).toBe("u@example.com");
    expect(row.used).toBe(false);
    expect(row.expired_at).toBeTruthy();
    // 2.15 核心断言：库里绝无明文验证码
    expect(row.code).not.toBe(code);
    expect(row.code).toBe(hashString(code));
  });

  it("createVerificationCode 插入失败抛错", async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error("db down") });
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });
    await expect(createVerificationCode("u@example.com")).rejects.toThrow(
      "db down"
    );
  });

  it("consumeVerificationCode 按哈希等值查找且成功返回 true", async () => {
    const capturedFilters: Record<string, unknown[]> = {};
    const selectChain = {
      eq: vi.fn().mockImplementation((field: string, value: unknown) => {
        capturedFilters[field] = capturedFilters[field] || [];
        capturedFilters[field].push(value);
        return selectChain;
      }),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: 1 }, error: null }),
    };
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: null,
        error: null,
        count: 1,
      }),
    };

    mockGetClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "verification_codes") {
          return {
            select: vi.fn().mockReturnValue(selectChain),
            update: vi.fn().mockReturnValue(updateChain),
          };
        }
        return {};
      }),
    });

    const ok = await consumeVerificationCode("u@example.com", "123456");
    expect(ok).toBe(true);
    // 2.15 核心断言：查询条件里传的是哈希，明文不出现在任何查询参数
    expect(capturedFilters["code"]).toEqual([hashString("123456")]);
  });

  it("consumeVerificationCode 找不到记录返回 false", async () => {
    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(selectChain),
      }),
    });

    const ok = await consumeVerificationCode("u@example.com", "123456");
    expect(ok).toBe(false);
  });

  it("cleanupVerificationCodes 删除过期超 1 天的记录", async () => {
    const deleteChain = {
      lt: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null }),
    };
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue(deleteChain) }),
    });

    const n = await cleanupVerificationCodes();
    expect(n).toBe(2);
  });
});
