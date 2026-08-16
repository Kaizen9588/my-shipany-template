/**
 * CSV 导出工具（6.8 订单导出）
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // CSV 公式注入（CSV Injection）：以 = + - @ 或 tab/CR 开头的值在 Excel 打开时
    // 会被当作公式执行。前置单引号使其成为纯文本。负数字段（如积分 -5）会被标为
    // "文本型数字"，对管理员只读导出可接受，换取杜绝公式投毒。
    const needsPrefix =
      s.startsWith("=") ||
      s.startsWith("+") ||
      s.startsWith("-") ||
      s.startsWith("@") ||
      s.startsWith("\t") ||
      s.startsWith("\r");
    const safe = needsPrefix ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
