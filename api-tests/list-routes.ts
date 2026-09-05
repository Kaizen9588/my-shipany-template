/**
 * 路由清单工具：打印 app/api 下全部 route.ts 的「METHOD /api/path」。
 * 用于更新 coverage.spec.ts 登记表（pnpm api-test:routes）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "app", "api");
const entries: string[] = [];
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === "route.ts") {
      const rel = p.slice(ROOT.length).replace(/\/route\.ts$/, "");
      const apiPath = `/api${rel.replace(/\[\.\.\.([^\]]+)\]/, "*$1")}`;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
        entries.push(`${m[1]} ${apiPath}`);
      }
    }
  }
}
walk(ROOT);
console.log(entries.sort().join("\n"));
