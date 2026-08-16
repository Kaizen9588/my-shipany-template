import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/lib/ip", () => ({ getClientIp: vi.fn(async () => "1.2.3.4") }));

import { fireAndForgetAudit, writeAuditLog } from "@/lib/audit";
import { getSupabaseClient } from "@/models/db";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;

describe("lib/audit（后台操作审计）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writeAuditLog 写入 audit_logs", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });

    await writeAuditLog({
      admin_uuid: "admin-1",
      action: "admin.user.update",
      target_type: "user",
      target_uuid: "u1",
      detail: "{}",
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row.admin_uuid).toBe("admin-1");
    expect(row.action).toBe("admin.user.update");
  });

  it("writeAuditLog 失败时吞错不抛", async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error("db down") });
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });

    await expect(
      writeAuditLog({ admin_uuid: "a", action: "x" })
    ).resolves.toBeUndefined();
  });

  it("fireAndForgetAudit 不阻塞", () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });

    expect(() =>
      fireAndForgetAudit({ admin_uuid: "a", action: "x" })
    ).not.toThrow();
  });
});
