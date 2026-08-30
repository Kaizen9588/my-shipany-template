import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({
  getSupabaseClient: vi.fn(),
}));
vi.mock("@/models/user", () => ({
  findUserByUuid: vi.fn(),
}));

import { getSupabaseClient } from "@/models/db";
import { findUserByUuid } from "@/models/user";
import {
  PasswordChangeError,
  changeUserPassword,
} from "@/services/user-password";
import { hashPassword } from "@/lib/password";

const mockFindUser = findUserByUuid as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = vi.fn();
const mockEq = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockEq.mockResolvedValue({ error: null });
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockGetClient.mockReturnValue({ from: () => ({ update: mockUpdate }) });
});

describe("services/user-password（默认管理员强制改密）", () => {
  it("拒绝：未提供当前密码", async () => {
    await expect(
      changeUserPassword({ userUuid: "u1", currentPassword: "", newPassword: "abc12345" })
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });

  it("拒绝：新密码与当前密码相同", async () => {
    await expect(
      changeUserPassword({ userUuid: "u1", currentPassword: "abc12345", newPassword: "abc12345" })
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });

  it("拒绝：新密码强度不足", async () => {
    mockFindUser.mockResolvedValue({ uuid: "u1", password_hash: "hash" });
    await expect(
      changeUserPassword({ userUuid: "u1", currentPassword: "123456", newPassword: "1234567" })
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });

  it("拒绝：用户不存在", async () => {
    mockFindUser.mockResolvedValue(undefined);
    await expect(
      changeUserPassword({ userUuid: "missing", currentPassword: "123456", newPassword: "abc12345" })
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });

  it("拒绝：账号未开启密码登录", async () => {
    mockFindUser.mockResolvedValue({ uuid: "u1", password_hash: null });
    await expect(
      changeUserPassword({ userUuid: "u1", currentPassword: "123456", newPassword: "abc12345" })
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });

  it("拒绝：当前密码错误", async () => {
    const passwordHash = await hashPassword("123456");
    mockFindUser.mockResolvedValue({ uuid: "u1", password_hash: passwordHash });
    await expect(
      changeUserPassword({ userUuid: "u1", currentPassword: "wrong1", newPassword: "abc12345" })
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });

  it("成功：校验通过后更新密码并清除强制改密标志", async () => {
    const passwordHash = await hashPassword("123456");
    mockFindUser.mockResolvedValue({
      uuid: "u1",
      password_hash: passwordHash,
      email: "admin@example.com",
      status: "pending_activation",
    });

    await changeUserPassword({
      userUuid: "u1",
      currentPassword: "123456",
      newPassword: "abc12345",
    });

    expect(mockGetClient).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [updateArg] = mockUpdate.mock.calls[0];

    // update 参数：写入了新哈希 + 清除了 must_change_password
    expect(updateArg).toMatchObject({
      must_change_password: false,
      status: "active",
      password_hash: expect.any(String),
      password_updated_at: expect.any(String),
    });
    // eq 使用 uuid
    expect(mockEq).toHaveBeenCalledWith("uuid", "u1");
  });
});
