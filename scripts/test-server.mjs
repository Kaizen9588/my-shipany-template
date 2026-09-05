/**
 * 测试专用 dev server 启动器：加载指定 env 文件后再 spawn next dev。
 *
 * 为什么不用 cross-env 内联：env 变量太多且含长 JWT，独立文件可维护；
 * 为什么不直接 next dev：Next 不读自定义 env 文件，NextAuth/SUPABASE_URL 等
 * 必须在进程启动前注入（models/db.ts 的 client 单例按启动时 env 构建）。
 *
 * 用法：node scripts/test-server.mjs <env-file> [port]
 *   - API 测试：node scripts/test-server.mjs .env.api-test 3100
 *   - E2E：     node scripts/test-server.mjs .env.e2e-test 3101
 * env 文件必须存在（缺文件直接失败，防止静默落到线上/默认环境）。
 * .env.local 永不加载：测试必须与日常 dev 环境完全隔离。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [envFile, portArg] = process.argv.slice(2);
if (!envFile) {
  console.error("usage: node scripts/test-server.mjs <env-file> [port]");
  process.exit(1);
}
if (!existsSync(resolve(process.cwd(), envFile))) {
  console.error(`[test-server] env file not found: ${envFile} — refusing to start without isolation`);
  process.exit(1);
}

function loadEnvFile(f) {
  const p = resolve(process.cwd(), f);
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(envFile);

const port = portArg || process.env.PORT || "3100";
const child = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  env: process.env,
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code) => process.exit(code ?? 0));
