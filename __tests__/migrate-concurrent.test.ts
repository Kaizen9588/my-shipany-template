import { describe, expect, it } from "vitest";
import {
  assertConcurrentOnly,
  findVersionConflicts,
  getConcurrentMigrationFiles,
} from "@/lib/migrate-concurrent";

describe("lib/migrate-concurrent（N-11 发布机制补全：CONCURRENTLY 专用迁移）", () => {
  it("assertConcurrentOnly：放行 CREATE/DROP INDEX CONCURRENTLY 与 COMMENT", () => {
    expect(() =>
      assertConcurrentOnly(
        "CREATE INDEX CONCURRENTLY idx_a ON t(c);",
        "0001_x.sql"
      )
    ).not.toThrow();
    expect(() =>
      assertConcurrentOnly(
        "CREATE UNIQUE INDEX CONCURRENTLY idx_b ON t(c);\n-- comment\nDROP INDEX CONCURRENTLY idx_a;",
        "0001_x.sql"
      )
    ).not.toThrow();
    expect(() =>
      assertConcurrentOnly("COMMENT ON TABLE t IS 'x';", "0001_x.sql")
    ).not.toThrow();
  });

  it("assertConcurrentOnly：拒绝事务语义 DDL（autocommit 无回滚，失败留半成品）", () => {
    expect(() =>
      assertConcurrentOnly("CREATE INDEX idx_a ON t(c);", "0001_x.sql")
    ).toThrow(/only CONCURRENTLY statements/);
    expect(() =>
      assertConcurrentOnly("ALTER TABLE t ADD COLUMN c INT;", "0001_x.sql")
    ).toThrow(/only CONCURRENTLY statements/);
    expect(() =>
      assertConcurrentOnly("CREATE TABLE t2(id INT);", "0001_x.sql")
    ).toThrow(/only CONCURRENTLY statements/);
  });

  it("findVersionConflicts：两个迁移目录版本号不得重叠", () => {
    expect(
      findVersionConflicts(
        ["0001_a.sql", "0002_b.sql"],
        ["0003_c.sql", "0004_d.sql"]
      )
    ).toEqual([]);
    const conflicts = findVersionConflicts(
      ["0001_a.sql", "0002_b.sql"],
      ["0002_concurrent.sql"]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("0002: 0002_b.sql <-> 0002_concurrent.sql");
  });

  it("当前 concurrent 目录为空（占位，首个大表索引落地时启用）", () => {
    expect(getConcurrentMigrationFiles()).toEqual([]);
  });
});
