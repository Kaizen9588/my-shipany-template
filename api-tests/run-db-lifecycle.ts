/** CLI 入口：pnpm api-test:db-reset */
import { main } from "./db-lifecycle.ts";
main().catch((e) => {
  console.error("[api-test:db] failed:", e);
  process.exit(1);
});
