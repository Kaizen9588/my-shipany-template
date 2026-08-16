import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));

import { GET } from "@/app/api/health/route";
import { getSupabaseClient } from "@/models/db";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/health（6.16）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Supabase 正常时返回 200 ok", async () => {
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.services.supabase).toBe("up");
  });

  it("Supabase 异常时返回 503", async () => {
    mockGetClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
        }),
      }),
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.services.supabase).toBe("down");
  });
});
