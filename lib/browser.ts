/**
 * 客户端设备指纹工具（6.0.1 匿名演示）
 *
 * 使用 FingerprintJS 开源版（免费、自托管、数据不出服务器）。
 * 生成 device_id 随请求头 X-Device-Id 发送，服务端 sha256(ip + device_id)
 * 作为 anonymous_key（docs/14 §2.2）。
 *
 * 降级策略：指纹未就绪（异步加载/禁用）时返回空串，服务端退化为纯 IP 维度。
 */
import FingerprintJS, { Agent } from "@fingerprintjs/fingerprintjs";

let fpPromise: Promise<Agent> | null = null;

export async function getDeviceId(): Promise<string> {
  try {
    if (typeof window === "undefined") {
      return "";
    }
    if (!fpPromise) {
      fpPromise = FingerprintJS.load();
    }
    const fp = await fpPromise;
    const result = await fp.get();
    return result.visitorId || "";
  } catch (e) {
    return "";
  }
}

/** 构造带设备指纹的请求头（供演示端点 fetch 使用） */
export async function withDeviceIdHeaders(
  headers: Record<string, string> = {}
): Promise<Record<string, string>> {
  const deviceId = await getDeviceId();
  return {
    "Content-Type": "application/json",
    ...headers,
    ...(deviceId ? { "X-Device-Id": deviceId } : {}),
  };
}
