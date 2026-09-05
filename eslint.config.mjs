import nextBase from "eslint-config-next";

/**
 * Next.js 16 + ESLint 9 flat config。
 *
 * eslint-config-next 已导出 flat config（数组），直接展开即可。
 * 以下规则为 React 19 Compiler 新增的严格规则，对常见模式（媒体查询 Hook、
 * 匿名组件、effect 内同步 setState）误报较多，统一降为 warning 以便 lint 通过；
 * 后续可按需逐个修复并提升为 error。
 */
const eslintConfig = [
  ...nextBase,
  {
    ignores: [".next/**", "node_modules/**", "out/**", "build/**", "coverage/**"],
  },
  {
    // Playwright fixtures 的 use 回调参数是框架契约（非 React Hook），
    // rules-of-hooks 对 e2e/ 测试代码是误报
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    rules: {
      "react/display-name": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default eslintConfig;
