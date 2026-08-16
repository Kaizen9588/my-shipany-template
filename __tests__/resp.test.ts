import { describe, expect, it } from "vitest";
import { respData, respErr, respJson, respOk } from "@/lib/resp";

describe("lib/resp（统一响应格式）", () => {
  it("respData 返回 code=0 + data", async () => {
    const res = respData({ foo: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.message).toBe("ok");
    expect(body.data).toEqual({ foo: 1 });
  });

  it("respData 无 data 时返回空数组", async () => {
    const res = respData(undefined);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("respOk 返回 code=0", async () => {
    const res = respOk();
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.message).toBe("ok");
  });

  it("respErr 返回 code=-1", async () => {
    const res = respErr("something wrong");
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toBe("something wrong");
  });

  it("respJson 支持自定义 code/data", async () => {
    const res = respJson(42, "custom", { a: 1 });
    const body = await res.json();
    expect(body.code).toBe(42);
    expect(body.message).toBe("custom");
    expect(body.data).toEqual({ a: 1 });
  });
});
