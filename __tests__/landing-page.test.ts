import { describe, expect, it } from "vitest";
import { getLandingPage } from "@/services/page";

describe("services/page getLandingPage", () => {
  it("zh 加载中文文案", async () => {
    const page = await getLandingPage("zh");
    expect(page).toBeTruthy();
    expect(page.header?.brand?.title).toBeTruthy();
  });

  it("en 加载英文文案", async () => {
    const page = await getLandingPage("en");
    expect(page).toBeTruthy();
    expect(page.header?.brand?.title).toBeTruthy();
  });

  it("未知语言回退英文", async () => {
    const page = await getLandingPage("fr");
    expect(page).toBeTruthy();
    expect(page.header).toBeTruthy();
  });
});
