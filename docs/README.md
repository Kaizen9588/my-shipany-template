# my-shipany-template 技术文档

> 本目录包含项目的完整技术文档，供开发团队和 LLM 评审使用。

## 文档索引

| # | 文档 | 内容 | 状态 |
|---|------|------|------|
| 01 | [架构设计](./01-architecture.md) | 总体架构图、分层架构、请求处理流程、认证体系、i18n、组件体系、数据流 | ✅ 完成 |
| 02 | [API 接口文档](./02-api-reference.md) | 全部 10 个 API 端点的请求/响应/认证/业务流程，含待新增接口 | ✅ 完成 |
| 03 | [数据库设计](./03-database-schema.md) | 14 张表字段说明、ER 图、索引分析、存储过程（资金原子操作）、迁移机制、问题清单 | ✅ 完成 |
| 04 | [鉴权流程](./04-auth-flow.md) | NextAuth 配置、OAuth 登录流程、JWT/Session callback、安全问题 | ✅ 完成 |
| 05 | [支付与积分流程](./05-payment-credits-flow.md) | Stripe 支付流程、Webhook 处理、积分 FIFO 扣减算法、联盟营销 | ✅ 完成 |
| 06 | [组件文档](./06-components.md) | 28 个 UI 组件、14 个区块组件、Slot 插槽模式、Context/Hooks | ✅ 完成 |
| 07 | [部署文档](./07-deployment.md) | Vercel/Cloudflare/Docker 三种部署方式、本地开发配置、Stripe Webhook | ✅ 完成 |
| 08 | [配置与环境变量](./08-config-env.md) | 全部配置文件解析、环境变量清单（单一真相源，已有+待新增+废弃）、i18n 配置 | ✅ 完成 |
| 10 | [邮件系统设计](./10-email-system.md) | 事务/营销分离、Provider 抽象、模板管理、触发点、退订、合规 | ✅ 完成 |
| 11 | [埋点与监控方案](./11-telemetry-analytics.md) | 分析/回放/错误三层拆解、追踪抽象层、事件规范、漏斗、bug 复现、选型 | ✅ 完成 |
| 12 | [架构审查遗留项跟踪表](./12-architecture-adversarial-review.md) | 历轮审查结论：✅已落地 / ❌已否决 / ⬜待落地，不允许留过时结论 | ✅ 完成 |
| 13 | [AI 网关闭环](./13-ai-gateway.md) | 核心收费闭环：鉴权→余额校验→预估一次扣清→模型路由→失败退款，模型白名单，/api/v1 前缀 | ✅ 完成 |
| 14 | [免费试用额度](./14-anonymous-trial.md) | 匿名演示限流（设备指纹+IP 双维度，清 cookie/换 IP 无法刷）、登录赠 10 积分、用完提示充值、防刷边界 | ✅ 完成 |
| 15 | [专业模板完整度清单](./15-professional-checklist.md) | 工程化/Security/支付/AI/营销/控制台/后台/监控/部署 完整度评估 | ✅ 完成 |
| 16 | [可观测性与告警设计](./16-observability-alerting.md) | 日志采集（op_events）+ 支付渠道告警闭环 + 飞书/企微机器人通知（6.23 设计稿） | ✅ 完成 |
| 17 | [项目边界规范](./boundary-spec.md) | 禁止提交/密钥安全/API 越权/代码工程/Git 工作流的边界规则与 push 前自查 | ✅ 完成 |

### 支付专题文档（payment/）

| # | 文档 | 内容 | 状态 |
|---|------|------|------|
| P1 | [支付架构设计](./payment/provider-abstraction.md) | Provider 抽象层、支付方式抽象、热切换、三阶段渠道演进、路由 | ✅ 完成 |
| P2 | [Stripe 对接](./payment/stripe-integration.md) | Stripe API 对接细节、Webhook 事件、数据库映射 | ✅ 完成 |
| P3 | [Creem 对接](./payment/creem-integration.md) | Creem API 对接细节（MoR、无退款 API、HMAC 验签） | ✅ 完成 |
| P4 | [Waffo 对接](./payment/waffo-integration.md) | Waffo API 对接细节（MoR+PSP、RSA 验签、Auth&Capture） | ✅ 完成 |

另见根目录 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) - 完整开发方案（已有功能审计 + 待完成功能规划 + 路线图）。

## 技术栈速览

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Next.js (App Router, Turbopack) | 16.3.1 |
| 语言 | TypeScript | 5.7.2 |
| UI | React + Tailwind CSS + shadcn/ui | 19.2.8 / 3.4.19 |
| 数据库 | Supabase (PostgreSQL) | - |
| 鉴权 | NextAuth.js (Auth.js v5) | 5.0.0-beta.25 |
| 支付 | Creem + Waffo（多渠道抽象） | - |
| i18n | next-intl | 4.13.6 |
| AI | Vercel AI SDK | 4.1.x |
| 部署 | Vercel（首选） | - |

## 已知关键问题（高优先级）

> 以下问题经三轮对抗式审查确认，已全部纳入 DEVELOPMENT_PLAN.md 的 P-1 安全修复阶段（P-1.1 ~ P-1.11）。

| # | 问题 | 文档位置 | 严重程度 |
|---|------|----------|----------|
| 1 | Google One-Tap 不校验 aud，可伪造登录 | [04-auth-flow.md](./04-auth-flow.md) | 致命 |
| 2 | 积分扣减无余额检查，可透支 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) | 致命 |
| 3 | Checkout 信任客户端金额，可 0 成本攻击 | [02-api-reference.md](./02-api-reference.md) | 致命 |
| 4 | Snowflake workerId 硬编码，多实例重复订单号 | [03-database-schema.md](./03-database-schema.md) | 高 |
| 5 | Demo API 无认证无限流，可被滥用 | [02-api-reference.md](./02-api-reference.md) | 高 |
| 6 | /api/update-invite 无认证，可被伪造 | [02-api-reference.md](./02-api-reference.md) | 高 |
| 7 | 订单+积分+联盟非事务操作 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) | 高 |
| 8 | 直接使用 Service Role Key，无 RLS | [03-database-schema.md](./03-database-schema.md) | 高 |
| 9 | API Key 明文存储 | [03-database-schema.md](./03-database-schema.md) | 中高 |
| 10 | 并发注册导致 session 无 uuid | [04-auth-flow.md](./04-auth-flow.md) | 中 |
