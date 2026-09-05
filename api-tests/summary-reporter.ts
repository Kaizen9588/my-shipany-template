/**
 * 自定义汇总 reporter：按功能分组输出每个测试点的耗时/结果，聚合分组成功率与总成功率。
 *
 * 产物：
 * - api-tests/output/report-summary.json（机器可读，供趋势系统）
 * - api-tests/output/report-summary.md（人读，CI Job Summary / 报告门户直接渲染）
 *
 * 分组取 spec 文件名（public/auth/user/v1/admin/payment/cron/coverage），
 * 用例名即接口行为描述（命名规范：「METHOD /api/path 场景」开头）。
 */
import fs from "node:fs";
import path from "node:path";
import type {
  Reporter,
  FullResult,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

const OUT_DIR = path.resolve(
  __dirname,
  process.env.SUMMARY_REPORT_DIR || "output"
);

interface Entry {
  group: string;
  title: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

// 报告消费方（报告门户/趋势系统）依赖的字段契约。
// 破坏性变更必须递增 schemaVersion，消费方先看版本再解析（docs/18-api-testing.md「报告契约」）。
export const REPORT_SCHEMA_VERSION = 1;

interface GroupStat {
  group: string;
  total: number;
  passed: number;
  failed: number;
  successRate: number; // 0-1
  durationMs: number;
}

// 分组名前缀与输出目录可配置：API 测试用默认值（组名=spec 文件名，输出 api-tests/output）；
// E2E 复用时经构造参数传 outDir + groupPrefix="e2e:"，避免两套报告组名撞车。
export interface SummaryReporterOptions {
  /** 报告输出目录（相对本文件）。默认 output（即 api-tests/output） */
  outDir?: string;
  /** 分组名前缀，E2E 复用时传 "e2e:" */
  groupPrefix?: string;
}

class SummaryReporter implements Reporter {
  private outDir: string;
  private groupPrefix: string;
  private entries: Entry[] = [];
  private runStart = Date.now();

  constructor(options: SummaryReporterOptions = {}) {
    this.outDir = path.resolve(__dirname, options.outDir || process.env.SUMMARY_REPORT_DIR || "output");
    this.groupPrefix = options.groupPrefix || "";
  }

  onBegin() {
    fs.mkdirSync(this.outDir, { recursive: true });
    this.runStart = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // 跳过 expected failure 的噪音；重复跑取最后一次
    const group =
      this.groupPrefix + path.basename(test.location.file).replace(/\.spec\.ts$/, "");
    this.entries = this.entries.filter(
      (e) => !(e.group === group && e.title === test.title)
    );
    // skipped 是预期分支（如管理员未激活态用例在已激活库上），不计入通过率分母
    if (result.status === "skipped") {
      return;
    }
    const err = result.error?.message?.split("\n")[0];
    this.entries.push({
      group,
      title: test.title,
      ok: result.status === "passed",
      durationMs: Math.round(result.duration),
      error: result.status === "passed" ? undefined : err || result.status,
    });
  }

  onEnd(result: FullResult) {
    const groups = new Map<string, Entry[]>();
    for (const e of this.entries) {
      const list = groups.get(e.group) || [];
      list.push(e);
      groups.set(e.group, list);
    }

    const groupStats: GroupStat[] = [...groups.entries()]
      .map(([group, list]) => {
        const passed = list.filter((e) => e.ok).length;
        return {
          group,
          total: list.length,
          passed,
          failed: list.length - passed,
          successRate: list.length ? passed / list.length : 0,
          durationMs: list.reduce((s, e) => s + e.durationMs, 0),
        };
      })
      .sort((a, b) => a.group.localeCompare(b.group));

    const total = this.entries.length;
    const passed = this.entries.filter((e) => e.ok).length;
    const summary = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: result.status,
      wallClockMs: Date.now() - this.runStart,
      total,
      passed,
      failed: total - passed,
      successRate: total ? passed / total : 0,
      groups: groupStats,
      entries: this.entries,
    };

    fs.writeFileSync(
      path.join(this.outDir, "report-summary.json"),
      JSON.stringify(summary, null, 2)
    );
    fs.writeFileSync(
      path.join(this.outDir, "report-summary.md"),
      this.renderMarkdown(summary)
    );

    // 控制台摘要（CI 日志直接可读）
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    console.log("\n━━━ API Test Summary ━━━");
    for (const g of groupStats) {
      const mark = g.failed === 0 ? "✅" : "❌";
      console.log(
        `${mark} ${g.group.padEnd(10)} ${g.passed}/${g.total} ${pct(g.successRate)} (${g.durationMs}ms)`
      );
    }
    console.log(
      `${summary.failed === 0 ? "✅" : "❌"} TOTAL      ${passed}/${total} ${pct(summary.successRate)}\n`
    );
  }

  private renderMarkdown(s: ReturnType<typeof this.summaryShape>) {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const lines: string[] = [];
    lines.push(`# API 测试汇总报告`);
    lines.push("");
    lines.push(`- 时间：${s.generatedAt}`);
    lines.push(`- 总体：**${s.passed}/${s.total}（${pct(s.successRate)}）**，状态 ${s.status}，墙钟 ${(s.wallClockMs / 1000).toFixed(1)}s`);
    lines.push("");
    lines.push(`## 分组成功率`);
    lines.push("");
    lines.push(`| 分组 | 通过 | 成功率 | 耗时 |`);
    lines.push(`|---|---|---|---|`);
    for (const g of s.groups) {
      lines.push(
        `| ${g.group} | ${g.passed}/${g.total} | ${pct(g.successRate)} | ${g.durationMs}ms |`
      );
    }
    lines.push("");
    lines.push(`## 明细`);
    lines.push("");
    for (const g of s.groups) {
      lines.push(`### ${g.group}`);
      lines.push("");
      lines.push(`| 结果 | 用例 | 耗时 | 错误 |`);
      lines.push(`|---|---|---|---|`);
      for (const e of s.entries.filter((e) => e.group === g.group)) {
        lines.push(
          `| ${e.ok ? "✅" : "❌"} | ${e.title} | ${e.durationMs}ms | ${e.error ? `\`${e.error.slice(0, 120)}\`` : ""} |`
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  private summaryShape() {
    return {
      schemaVersion: 1,
      generatedAt: "",
      status: "",
      wallClockMs: 0,
      total: 0,
      passed: 0,
      failed: 0,
      successRate: 0,
      groups: [] as GroupStat[],
      entries: [] as Entry[],
    };
  }
}

export default SummaryReporter;
