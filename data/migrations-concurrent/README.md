# migrations-concurrent：非事务迁移专用目录（N-11 发布机制补全）

`CREATE INDEX CONCURRENTLY` 等语句不能在事务内执行，与 `lib/migrate.ts` 的
单事务迁移器不兼容。这类迁移放本目录，由 `pnpm migrate:concurrent`
（`lib/migrate-concurrent.ts`）以 **autocommit** 逐文件执行。

## 纪律

1. **只允许 CONCURRENTLY 类语句**：`CREATE [UNIQUE] INDEX CONCURRENTLY` /
   `DROP INDEX CONCURRENTLY` / `COMMENT ON`。脚本会静态拒绝其他语句——
   autocommit 无回滚，混入普通 DDL 失败即留半成品。
2. **先普通迁移后并发迁移**：部署顺序固定为
   `pnpm migrate`（事务迁移）→ `pnpm migrate:concurrent`（并发迁移）→ 发布应用。
   CI/deploy job 中两步必须显式分开。
3. **版本号不与 `data/migrations/` 重叠**：两个目录的版本写入同一张
   `schema_migrations`（`mode` 列区分 `transactional` / `concurrent`），
   重号会被先执行的一方抢先注册，另一方静默跳过。
4. **CONCURRENTLY 失败会留下 INVALID 索引**：重试前必须
   `DROP INDEX CONCURRENTLY` 该索引，否则后续 CREATE 会直接报错。
5. **大表判定基准**：预计执行时行数 > 100 万或表会持续写入时必须用本目录；
   启动/空库阶段的小表索引进 `data/migrations/` 走事务迁移即可。

## expand-contract 执行模板（破坏性变更三次发布）

- **expand**：新列/新表/新索引以可空或带默认值形态加入（事务迁移或本目录），
  应用同时写新旧两处（或仍只写旧处）。
- **migrate**：数据回填脚本/迁移把存量数据迁到新结构（大表回填分批，不走单事务）。
- **contract**：确认全部实例已发布新版后，下一次发布再删除旧列/旧约束
  （事务迁移）。**禁止在 expand 同一发布里做 contract**——旧实例还在写旧结构。
