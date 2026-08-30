import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (password: string) => `hash:${password}`),
}));

import { hashPassword } from "@/lib/password";
import { bootstrapAdmin } from "@/lib/bootstrap-admin";

function createClient(rows: Array<{ uuid: string }> = []) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [] }),
  };
}

describe("bootstrapAdmin", () => {
  it("未配置邮箱时不查询数据库也不创建账号", async () => {
    const client = createClient();

    await expect(bootstrapAdmin(client)).resolves.toEqual({
      status: "not_configured",
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("已有同邮箱用户时不提升权限或覆盖凭据", async () => {
    const client = createClient([{ uuid: "existing" }]);

    await expect(
      bootstrapAdmin(client, { ADMIN_BOOTSTRAP_EMAIL: "Admin@example.com" })
    ).resolves.toEqual({ status: "already_exists", email: "admin@example.com" });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("显式配置时创建 pending_activation 超级管理员", async () => {
    const client = createClient();

    const result = await bootstrapAdmin(client, {
      ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
      ADMIN_BOOTSTRAP_PASSWORD: "StrongPass123",
    });

    expect(result).toEqual({ status: "created", email: "admin@example.com" });
    expect(hashPassword).toHaveBeenCalledWith("StrongPass123");
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1][0]).toContain("'pending_activation'");
  });

  it("未提供密码时生成一次性强临时密码", async () => {
    const client = createClient();

    const result = await bootstrapAdmin(client, {
      ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
    });

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.temporaryPassword).toMatch(/^Aa1-/);
    }
  });
});
