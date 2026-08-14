# my-shipany-template 技术文档

> 本目录包含项目的完整技术文档，供开发团队和 LLM 评审使用。

## 文档索引

| # | 文档 | 内容 | 状态 |
|---|------|------|------|
| 01 | [架构设计](./01-architecture.md) | 总体架构图、分层架构、请求处理流程、认证体系、i18n、组件体系、数据流 | ✅ 完成 |
| 02 | [API 接口文档](./02-api-reference.md) | 全部 10 个 API 端点的请求/响应/认证/业务流程，含待新增接口 | ✅ 完成 |
| 03 | [数据库设计](./03-database-schema.md) | 6 张表的完整字段说明、ER 关系图、索引分析、设计问题清单 | ✅ 完成 |
| 04 | [鉴权流程](./04-auth-flow.md) | NextAuth 配置、OAuth 登录流程、JWT/Session callback、安全问题 | ✅ 完成 |
| 05 | [支付与积分流程](./05-payment-credits-flow.md) | Stripe 支付流程、Webhook 处理、积分 FIFO 扣减算法、联盟营销 | ✅ 完成 |
| 06 | [组件文档](./06-components.md) | 28 个 UI 组件、14 个区块组件、Slot 插槽模式、Context/Hooks | ✅ 完成 |
| 07 | [部署文档](./07-deployment.md) | Vercel/Cloudflare/Docker 三种部署方式、本地开发配置、Stripe Webhook | ✅ 完成 |
| 08 | [配置与环境变量](./08-config-env.md) | 全部配置文件解析、环境变量清单（已有+待新增）、i18n 配置 | ✅ 完成 |
| 09 | [架构评审意见](./09-architecture-review.md) | 22 个问题：6 严重安全 + 7 架构 + 5 代码质量 + 4 模板可复用性 + 优先级调整 | ✅ 已采纳 |

另见根目录 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) - 完整开发方案（已有功能审计 + 待完成功能规划 + 路线图）。

## 技术栈速览

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Next.js (App Router, Turbopack) | 16.3.1 |
| 语言 | TypeScript | 5.7.2 |
| UI | React + Tailwind CSS + shadcn/ui | 19.2.8 / 3.4.19 |
| 数据库 | Supabase (PostgreSQL) | - |
| 鉴权 | NextAuth.js (Auth.js v5) | 5.0.0-beta.25 |
| 支付 | Stripe | 17.5.0 |
| i18n | next-intl | 4.13.6 |
| AI | Vercel AI SDK | 4.1.x |
| 部署 | Vercel（首选） | - |

## 已知关键问题（高优先级）

> 以下问题经架构评审（[09-architecture-review.md](./09-architecture-review.md)）确认，已纳入 DEVELOPMENT_PLAN.md 的 P-1 安全修复阶段。

| # | 问题 | 文档位置 | 严重程度 |
|---|------|----------|----------|
| 1 | Demo API 无认证无限流，可被滥用 | [02-api-reference.md](./02-api-reference.md) | 高 |
| 2 | /api/update-invite 无认证，可被伪造 | [02-api-reference.md](./02-api-reference.md) | 高 |
| 3 | Stripe Webhook 仅处理 1 种事件 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) | 高 |
| 4 | 无 Creem 支付（用户需要） | [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) | 高 |
| 5 | 直接使用 Service Role Key，无 RLS | [03-database-schema.md](./03-database-schema.md) | 高 |
| 6 | 订单+积分+联盟非事务操作 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) | 高 |
| 7 | 后台管理只读，无数据看板 | [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) | 中 |
| 8 | next-auth beta 版本 | [04-auth-flow.md](./04-auth-flow.md) | 中 |
| 9 | 无邮件通知系统 | [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) | 中 |
| 10 | 无反馈/客服按钮 | [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) | 中 |
