import { describe, expect, it } from "vitest";
import {
  getMigrationFiles,
  getMigrationVersion,
  getPendingMigrationFiles,
} from "@/lib/migrate";

describe("lib/migrate", () => {
  it("只识别规范命名的 SQL 迁移文件并按版本排序", () => {
    const files = getMigrationFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toBe("0000_install_base.sql");
    expect(files).toEqual([...files].sort());
    expect(files.every((file) => /^\d+_[\w-]+\.sql$/.test(file))).toBe(true);
  });

  it("按已应用版本计算 pending，版本名而不是文件名是唯一标识", () => {
    const files = [
      "0000_install_base.sql",
      "0001_payment_products.sql",
      "0019_disable_legacy_default_admin.sql",
    ];

    expect(getMigrationVersion(files[1])).toBe("0001");
    expect(getPendingMigrationFiles(files, ["0000", "0019"])).toEqual([
      "0001_payment_products.sql",
    ]);
  });
});
