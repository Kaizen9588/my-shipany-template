import { SnowflakeIdv1 } from "simple-flakeid";
import { createHash, randomInt } from "crypto";
import { v4 as uuidv4 } from "uuid";

export function getUuid(): string {
  return uuidv4();
}

export function getUniSeq(prefix: string = ""): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);

  return `${prefix}${randomPart}${timestamp}`;
}

/**
 * 随机字符串（密码学安全）
 *
 * S2：验证码与 API Key（sk- 前缀）共用此函数，必须用 crypto.randomInt——
 * 原 Math.random() 非密码学安全，验证码可预测、API Key 熵前提被破坏。
 * randomInt 无模偏差，无需拒绝采样。
 */
export function getNonceStr(length: number): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += characters[randomInt(characters.length)];
  }

  return result;
}

// P-1.11：Snowflake 生成器必须是模块级单例 —— 生成器内部维护毫秒内递增的序列号，
// 每次 new 会重置序列，同毫秒多次调用会生成重复 ID（曾导致 order_no 唯一约束冲突）
let snowflakeGen: SnowflakeIdv1 | null = null;

function getSnowflakeGen(): SnowflakeIdv1 {
  if (!snowflakeGen) {
    // workerId 从环境变量注入，多实例部署时每实例唯一
    const workerId =
      parseInt(process.env.SNOWFLAKE_WORKER_ID || "1", 10) || 1;
    snowflakeGen = new SnowflakeIdv1({ workerId });
  }
  return snowflakeGen;
}

export function getSnowId(): string {
  const snowId = getSnowflakeGen().NextId();

  return snowId.toString();
}

/** SHA-256 哈希（P-1.5：API Key 只存哈希，不存明文） */
export function hashString(str: string): string {
  return createHash("sha256").update(str).digest("hex");
}
