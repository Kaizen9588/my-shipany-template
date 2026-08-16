import { afterEach, describe, expect, it } from "vitest";
import { getStorageKey } from "@/lib/storage";

const ORIGINAL_ENV = process.env;

describe("lib/storage getStorageKey", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("使用 STORAGE_PREFIX 作为前缀", () => {
    process.env.STORAGE_PREFIX = "myapp";
    expect(getStorageKey("avatar.png")).toBe("myapp/avatar.png");
  });

  it("无 STORAGE_PREFIX 时使用项目名", () => {
    delete process.env.STORAGE_PREFIX;
    process.env.NEXT_PUBLIC_PROJECT_NAME = "ship-test";
    expect(getStorageKey("a/b.png")).toBe("ship-test/a/b.png");
  });

  it("都没有时用 default", () => {
    delete process.env.STORAGE_PREFIX;
    delete process.env.NEXT_PUBLIC_PROJECT_NAME;
    expect(getStorageKey("x")).toBe("default/x");
  });
});
