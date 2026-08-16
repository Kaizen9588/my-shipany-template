import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-node", () => ({
  PostHog: class MockPostHog {
    capture = vi.fn();
    identify = vi.fn();
  },
}));

import { TelemetryEvents, identifyServer, trackServer } from "@/lib/telemetry/server";

const ORIGINAL_ENV = process.env;

describe("lib/telemetry/server（6.5）", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("未配置 key 时静默不抛错", () => {
    expect(() =>
      trackServer({
        name: TelemetryEvents.PaymentSucceeded,
        distinctId: "u1",
      })
    ).not.toThrow();
    expect(() => identifyServer("u1")).not.toThrow();
  });

  it("配置 key 后调用 capture（不阻塞）", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    expect(() =>
      trackServer({
        name: TelemetryEvents.CheckoutStarted,
        distinctId: "u1",
        properties: { order_no: "o1" },
      })
    ).not.toThrow();
  });
});
