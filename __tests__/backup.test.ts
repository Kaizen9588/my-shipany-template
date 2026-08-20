import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockStorage, mockUploadFile } = vi.hoisted(() => {
  const mockUploadFile = vi.fn();
  class MockStorage {
    uploadFile = mockUploadFile;
  }
  return { MockStorage, mockUploadFile };
});

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  Storage: MockStorage,
  getStorageKey: vi.fn((f: string) => `prefix/${f}`),
}));

import { backupKeyTables } from "@/lib/backup";
import { getSupabaseClient } from "@/models/db";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;

describe("lib/backup backupKeyTables（6.16）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // L4：备份前置条件 —— 未配置 STORAGE_BUCKET 时直接跳过（防御 S3 SDK 空配置挂起）
    process.env.STORAGE_BUCKET = "test-bucket";
    mockUploadFile.mockResolvedValue({
      key: "prefix/users-2026-01-01.json",
    });
  });

  it("STORAGE 未配置时跳过备份（不触达 S3/DB）", async () => {
    delete process.env.STORAGE_BUCKET;
    const from = vi.fn();
    mockGetClient.mockReturnValue({ from });

    const result = await backupKeyTables();
    expect(result.error).toContain("storage not configured");
    expect(result.exported.length).toBe(0);
    expect(from).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("导出三张表到存储", async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
    });
    mockGetClient.mockReturnValue({ from });

    const result = await backupKeyTables();
    expect(result.error).toBeUndefined();
    expect(result.exported.length).toBe(3);
    expect(mockUploadFile).toHaveBeenCalledTimes(3);
  });

  it("某表查询失败时返回错误", async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    });
    mockGetClient.mockReturnValue({ from });

    const result = await backupKeyTables();
    expect(result.error).toContain("users");
    expect(result.exported.length).toBe(0);
  });
});
