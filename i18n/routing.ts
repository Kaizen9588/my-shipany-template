import {
  defaultLocale,
  localeDetection,
  localePrefix,
  locales,
} from "./locale";

import { defineRouting } from "next-intl/routing";

// 仅包含 routing 配置：middleware(edge bundle)也会引用本文件,
// 不能把 createNavigation(带 React 客户端依赖)混进来,否则 edge 下导出解析异常。
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix,
  localeDetection,
});
