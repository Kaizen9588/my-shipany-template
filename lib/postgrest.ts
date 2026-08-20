/**
 * PostgREST 过滤串安全辅助（docs/17 T1）
 *
 * `.or()` 传入的是 PostgreSQL 过滤语法字符串而非参数绑定，用户关键字直接拼入
 * 会形成 filter 语法注入面（逗号/括号/引号/反斜杠可改变过滤语义）。
 * 虽然现有用法无法越权或绕过外层 status 过滤，仍需把用户输入清洗成安全片段：
 * - 剥离 PostgREST 语法分隔符（`,` `(` `)` `"` `'` `` ` `` `\`）
 * - 剥离 ILIKE 通配符 `%`/`_`，避免一次匹配全表（大结果 + 查询放大）
 * - 保留字母/数字/空格/常见标点（含 `.`，PostgREST 值段允许点，如时间戳）
 */

export function safeLikeValue(keyword: string): string {
  return keyword
    .replace(/[,()"'`\\%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 返回可直接拼进 .or() 的 `col.ilike.%kw%`；清洗后为空时返回空串 */
export function likeFilter(column: string, keyword: string): string {
  const value = safeLikeValue(keyword);
  if (!value) return "";
  return `${column}.ilike.%${value}%`;
}
