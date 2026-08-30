# my-shipany-template 技术文档

> 本目录包含项目的完整技术文档，供开发团队和 LLM 评审使用。

## 文档索引

| # | 文档 | 内容 | 状态 |
|---|------|------|------|
| 01 | [架构设计](./01-architecture.md) | 总体架构图、分层架构、请求处理流程、认证体系、i18n、组件体系、数据流 | ✅ 完成 |
| 02 | [API 接口文档](./02-api-reference.md) | API 端点请求/响应/认证/幂等键/错误码 | ⚠️ 部分待建（幂等键） |
| 03 | [数据库设计](./03-database-schema.md) | 表结构、ER 图、索引、存储过程、迁移机制、权限边界、待建表（credit lots/refunds/payment events/ai_requests） | ⚠️ No-Go（资金权限 + 批次账本） |
| 04 | [鉴权流程](./04-auth-flow.md) | NextAuth 配置、OAuth 登录、JWT/Session、验证码、RBAC、账号删除、安全问题 | ⚠️ No-Go（验证码消费逻辑 + 封禁失效） |
| 05 | [支付与积分流程](./05-payment-credits-flow.md) | 多渠道支付、Webhook、积分扣减、退款、联盟营销、生产安全门槛 | ⚠️ No-Go（批次账本 + 部分退款 + 对账） |
| 06 | [组件文档](./06-components.md) | 29 个 UI 组件、22 个区块组件、Slot 插槽模式、Context/Hooks | ✅ 完成 |
| 07 | [部署文档](./07-deployment.md) | Vercel/Cloudflare/Docker 三种部署方式、本地开发配置、Stripe Webhook | ✅ 完成 |
| 08 | [配置与环境变量](./08-config-env.md) | 全部配置文件解析、环境变量清单（单一真相源，已有+待新增+废弃）、i18n 配置 | ✅ 完成 |
| 10 | [邮件系统设计](./10-email-system.md) | 事务/营销分离、Provider 抽象、模板管理、触发点、退订、合规 | ⚠️ v2 待建（email logs + 退订） |
| 11 | [埋点与监控方案](./11-telemetry-analytics.md) | 分析/回放/错误三层拆解、追踪抽象层、事件规范、漏斗、bug 复现、选型 | ⚠️ 部分待建（GDPR 删除） |
| 13 | [AI 网关闭环](./13-ai-gateway.md) | 核心收费闭环：鉴权→余额校验→预估一次扣清→模型路由→失败退款，幂等/状态机/补偿设计 | ⚠️ No-Go（幂等 + 崩溃补偿） |
| 14 | [免费试用额度](./14-anonymous-trial.md) | 匿名演示限流（纯 IP 维度，指纹方案已废弃，换 IP 可绕过为已知边界） | ⚠️ No-Go（失败退还 + 无输入限制可单 IP 无限调用，P0-4） |
| 15 | [专业模板完整度清单](./15-professional-checklist.md) | 工程化/Security/支付/AI/营销/控制台/后台/监控/部署 完整度评估（三态标记） | ⚠️ 多项 No-Go |
| 16 | [可观测性与告警设计](./16-observability-alerting.md) | 日志采集（op_events）+ 支付渠道告警 + 飞书/企微通知 + Cron 安全 + 飞书多维表格大屏数据源（§八） | ⚠️ 部分待建（outbox + 对账 + 大屏待生产配置） |
| B | [项目边界规范](./boundary-spec.md) | 禁止提交/密钥安全/API 越权/代码工程/Git 工作流/No-Go 缺口清单 | ⚠️ 多项 No-Go |

> **整体生产就绪结论**：模板骨架完整度高，但**资金与计费闭环不满足真实收费标准（No-Go）**。
> 各模块文档的 ⚠️ / ❌ 项汇总为生产上线门槛，详见 [边界规范 §No-Go 清单](./boundary-spec.md#九待关闭的边界缺口生产-no-go-清单)。

### 支付专题文档（payment/）

| # | 文档 | 内容 | 状态 |
|---|------|------|------|
| P1 | [支付架构设计](./payment/provider-abstraction.md) | Provider 抽象层、支付方式抽象、热切换、三阶段渠道演进、路由 | ✅ 完成 |
| P2 | [Stripe 对接](./payment/stripe-integration.md) | Stripe API 对接细节、Webhook 事件、数据库映射 | ✅ 完成 |
| P3 | [Creem 对接](./payment/creem-integration.md) | Creem API 对接细节（MoR、无退款 API、HMAC 验签） | ✅ 完成 |
| P4 | [Waffo 对接](./payment/waffo-integration.md) | 上一代 API 对接存档（@waffo/waffo-node + /api/v1/order/*；官方已迁 Pancake，无官方背书） | ⚠️ 历史存档 |
| P5 | [Waffo 操作指南](./payment/waffo-operations-guide.md) | 基于官方 docs.waffo.ai 现行文档：开通/KYB/密钥、建店建品、Checkout/Webhook/沙箱/上线清单、新旧 API 迁移决策（✅ 路线 B 已于 2026-08-27 执行） | ✅ 完成 |
| P6 | [渠道切换 SOP](./payment/channel-switch-sop.md) | 「后台点按钮换渠道」Runbook：常备就绪项、计划内/紧急切换、回滚、MoR↔PSP 税费口径检查、切换台账 | ✅ 完成 |

另见根目录 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) - 完整开发方案（已有功能审计 + 待完成功能规划 + 路线图）。

## 技术栈速览

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Next.js (App Router, Turbopack) | 16.3.1 |
| 语言 | TypeScript | 5.7.2 |
| UI | React + Tailwind CSS + shadcn/ui | 19.2.8 / 3.4.19 |
| 数据库 | Supabase (PostgreSQL) | - |
| 鉴权 | NextAuth.js (Auth.js v5) | 5.0.0-beta.25 |
| 支付 | Stripe + Creem + Waffo（多渠道抽象） | - |
| i18n | next-intl | 4.13.6 |
| AI | Vercel AI SDK | 4.1.x |
| 部署 | Vercel（首选） | - |

## 已关闭的历史安全问题（P-1 阶段）

> 以下问题经前三轮对抗式审查识别，已在 P-1 安全修复阶段全部落地。
> 当前状态：✅ 已修复。

| # | 问题 | 文档位置 | 严重程度 | 状态 |
|---|------|----------|----------|------|
| 1 | Google One-Tap 不校验 aud，可伪造登录 | [04-auth-flow.md](./04-auth-flow.md) | 致命 | ✅ 已修复（P-1.11） |
| 2 | 积分扣减无余额检查，可透支 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) | 致命 | ✅ 已修复（P-1.2） |
| 3 | Checkout 信任客户端金额，可 0 成本攻击 | [02-api-reference.md](./02-api-reference.md) | 致命 | ✅ 已修复（P-1.1） |
| 4 | Snowflake workerId 硬编码，多实例重复订单号 | [03-database-schema.md](./03-database-schema.md) | 高 | ✅ 已修复（P-1.11） |
| 5 | Demo API 无认证无限流，可被滥用 | [02-api-reference.md](./02-api-reference.md) | 高 | ✅ 已修复（P-1.4，重构为匿名演示端点） |
| 6 | /api/update-invite 无认证，可被伪造 | [02-api-reference.md](./02-api-reference.md) | 高 | ✅ 已修复（P-1.4） |
| 7 | 订单+积分+联盟非事务操作 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) | 高 | ✅ 已修复（P-1.3，迁移 0003/0017） |
| 8 | 直接使用 Service Role Key，无 RLS | [03-database-schema.md](./03-database-schema.md) | 高 | ⚠️ 部分修复（服务端单例收口；RLS + schema 权限仍 No-Go） |
| 9 | API Key 明文存储 | [03-database-schema.md](./03-database-schema.md) | 中高 | ✅ 已修复（P-1.5，SHA-256 hash） |
| 10 | 并发注册导致 session 无 uuid | [04-auth-flow.md](./04-auth-flow.md) | 中 | ✅ 已修复（P-1.11，并发注册兜底） |

---

## 当前生产阻断问题（P0 / No-Go）

> 第八轮（2026-08）对抗式审查新识别的阻断项。
> **全部关闭前，不建议开放真实生产收款。**
> 详细分析与整改要求已写入对应模块文档。

| # | 问题 | 所在模块 | 位置 |
|---|------|----------|------|
| 1 | 资金 RPC 权限边界不成立（public schema 无 REVOKE/GRANT/RLS） | 数据库 | [03 §权限与安全边界](./03-database-schema.md#权限与安全边界生产强制) |
| 2 | 积分过期账本设计缺陷（永久负数 + 净额模型） | 支付与积分 | [05 §2.4 剩余设计缺陷](./05-payment-credits-flow.md) |
| 3 | 部分退款与积分回收不一致 | 支付与积分 | [05 §4.2 部分退款风险](./05-payment-credits-flow.md) |
| 4 | AI 网关无幂等键、崩溃补偿和状态机 | AI 网关 | [13 §九 v1.5 目标设计](./13-ai-gateway.md#九v15-目标设计幂等--状态机--补偿) |
| 5 | 远端支付成功、本地落库失败无可靠恢复 | 支付与积分 | [05 §5.1 P0-对账-1](./05-payment-credits-flow.md) |
| 6 | 管理员通知配置 API 回显完整 Webhook Secret | 边界规范 | [boundary-spec §No-Go 清单](./boundary-spec.md#九待关闭的边界缺口生产-no-go-清单) |
| 7 | 邮箱验证码消费逻辑疑似在真实环境始终失败 | 鉴权 | [04 §7 鉴权安全问题](./04-auth-flow.md#七鉴权安全问题) |
| 8 | Webhook 缺少事件 inbox 与强绑定 | 支付与积分 | [05 §5.1 P0-Webhook-1](./05-payment-credits-flow.md) |

---

## 第九轮对抗式审查（2026-08-26）新增阻断项

> 来源：[ADVERSARIAL-REVIEW-2026-08-26.md](./ADVERSARIAL-REVIEW-2026-08-26.md)。
> 本轮 10 条存活 + 人工复核补入 2 条，已回写各模块文档；被反驳剔除的 18 条不要据此修改文档。
> **核心结论**：上一轮的 5 条 P0 验收标准本身有洞，且本轮新增 6 处错误 ✅（比「没修」更危险）。详情见下列各模块。

| # | 问题 | 级别 | 已回写位置 |
|---|------|------|-----------|
| P0-1 | 退款/拒付对已消费积分无回收路径，方案 A/B 都不闭环 | 阻断 | [05 §4.3](./05-payment-credits-flow.md) + [03 退款表](./03-database-schema.md) |
| P0-2 | `decrease_credits`「行锁串行化」论证不成立 | 阻断 | [03 §3/§存储过程](./03-database-schema.md) + [05 §2.4](./05-payment-credits-flow.md) |
| P0-3 | ~~自动迁移向生产库种入公开默认超级管理员~~ | ✅ 已关闭（2026-08-30） | 0012 取消建号、0019 禁用历史固定 hash、显式环境变量一次性引导；见 [boundary-spec §二/§九](./boundary-spec.md) |
| P0-4 | 匿名 demo「失败退还次数 + 无输入限制」= 单 IP 绕过每日 3 次 | 阻断 | [14 §2.5/§五](./14-anonymous-trial.md) + [13 §八](./13-ai-gateway.md) |
| P1-5 | 幂等键作用域自相矛盾（全局 UNIQUE vs 按用户作用域） | P1-高 | [02 幂等性](./02-api-reference.md) + [03 ai_requests](./03-database-schema.md) + [13 §四](./13-ai-gateway.md) |
| P1-6 | 两条互斥建库路径（install.sql vs 迁移 0000 基线） | P1-高 | [07 §2.1/§5.2](./07-deployment.md) + [03 概述](./03-database-schema.md) |
| P1-7 | 启动自动迁移无并发锁/事务/回滚/发布顺序 | P1-高 | [03 存储过程](./03-database-schema.md) + [07 §5.2.1](./07-deployment.md) |
| P1-8 | 定价真相源两份文档互相矛盾（表优先 vs 文件唯一真相源） | P1-高 | [05 §1.2](./05-payment-credits-flow.md) + [02](./02-api-reference.md) + [01](./01-architecture.md) + [16](./16-observability-alerting.md) |
| P2-1 | 积分有效期在下单时刻冻结 | P2-中 | [05 §7.1](./05-payment-credits-flow.md) + [03 orders](./03-database-schema.md) |
| P2-2 | 争议/拒付（chargeback）全链路缺失 | P2-中 | [05 §7.2](./05-payment-credits-flow.md) + payment 三渠道文档 |
| P3-1 | 悬空文档引用（docs/12、docs/17 已删除，8 处引用仍在） | P3-低 | 见下文 |

### P3-1 悬空文档引用清单

`docs/12-architecture-adversarial-review.md` 与 `docs/17-adversarial-test-round6.md` 已删除（工作区未提交），
但仍有 8 处引用 `docs/12`，且它被描述为「遗留项跟踪表」的唯一汇总处：

- `README.md:338`（根目录）
- `DEVELOPMENT_PLAN.md:17 / 795 / 852`
- `docs/03:402`
- `docs/boundary-spec:28 / 56`
- `docs/01:72 / 133`
- `docs/payment/provider-abstraction.md:228`

另：`docs/13` 文首「详见本文第 10 节」但全文只到 §九；本文件原 No-Go #4 的锚点 `#九v15-目标设计幂等--状态机--补偿` 实际不存在
（§九 标题是「对抗式自检」），即 AI 网关三大件（幂等键 / 状态机 / 崩溃补偿）的整改设计正文从未写过。`boundary-spec` 章节编号为
「一二三四九五」且缺六七八。`docs/` 内的 `docs/12` 引用已在本轮回写时指向 ADVERSARIAL-REVIEW 文件；根目录 `README.md` 与
`DEVELOPMENT_PLAN.md` 的引用待收口。

### 上线前必须关闭（按依赖顺序）

1. 关掉默认管理员弱口令（P0-3）；README 删逐字凭据。
2. 把 6 处错误 ✅ 降级（boundary-spec:47、README:61、05:207、13:43、15:46、03:586 的透支/迁移机制声明）。
3. 钉死定价真相源（P1-8），据此重定级 P1-定价-1。
4. 统一建库路径（P1-6）。
5. 迁移器加 advisory lock + 同事务 + fail-fast + CONCURRENTLY（P1-7）。
6. `decrease_credits` 加 advisory lock + 并发回归测试进 CI（P0-2）。
7. 匿名 demo 退还语义收紧 + 输入 413 照常计次 + fail-closed 限流（P0-4）。
8. **`credit_lots` 批次账本落地**（分水岭，顺带关闭 P2-1）；第 8 项之前不要开真实收款。
9. 退款闭环（P0-1 债务化 + restricted）。
10. 争议链路（P2-2）。
11. webhook inbox + 每日对账（口径补「退款成功但积分回收为 0」与争议差异）。
12. 幂等键生命周期（P1-5）。
13. 跨实例限流 + AI 成本/错误率告警 + 迁移失败告警发射点。
14. 退款政策条款、争议举证导出、风控节流。
15. 文档收口：No-Go 补建库路径/迁移并发/争议链路/默认管理员/AI 网关整改正文；清理 8 处 docs/12 悬空引用。

---

## 第十轮对抗式审查（2026-08-26）

> 本轮通读全部 22 份方案文档（约 7300 行），逐条对照第八/九轮存活项与被反驳条目去重后存活 13 条（含回写时新发现 1 条）。
> **核心结论：资金主链路（账本/退款/争议/迁移/并发）无新增 P0**——本轮问题集中在副作用执行模型与文档间一致性。
> 全部条目已回写各模块文档；下表「已回写位置」即整改正文所在。

| # | 问题 | 级别 | 已回写位置 |
|---|------|------|-----------|
| P1-A | fire-and-forget 副作用在首选部署形态（Vercel serverless）下无执行模型保障：`after()`/`waitUntil` 全仓零命中，响应返回后未 await 的 promise 不保证执行——邮件、埋点（含漏斗 t3 锚点）、告警三条链路可能一次都不跑。N-4 管「落库不丢」，本条管「有没有开始跑」 | **P1** | [10 §2.3](./10-email-system.md) + [11 §4.1](./11-telemetry-analytics.md) + [16 §3.3](./16-observability-alerting.md) + [boundary-spec §四](./boundary-spec.md) |
| P2-B | payment_success 邮件触发点挂在已废弃的 services 编排路径上（handleOrderPayment 已退化为历史存档），webhook 路径无人发信 | P2 | [10 §四触发点表](./10-email-system.md) |
| P2-C | docs/07 Stripe webhook 订阅指引只有 `checkout.session.completed`，缺已实现的 `charge.refunded`——按文档配置则退款同步整体失效且仅 No-Go 对账可兜 | P2 | [07 §2.5](./07-deployment.md) |
| P2-D | docs/15 两处错误状态标记：「订阅管理 ✅」与同文件「v1 不启用」矛盾、「错误监控 ✅」与 docs/11「❌ 无 / v2 规划」矛盾（第九轮「错误 ✅」同类增量） | P2 | [15 §八/§十](./15-professional-checklist.md) |
| P3-1 | creem-integration §6 整节仍是废弃的 `NEXT_PUBLIC_PAYMENT_PROVIDER` 多入口机制（变量已在 docs/08 登记废弃），示例违反「前端不传渠道名」硬规则 | P3 | [creem §6 头部废弃横幅](./payment/creem-integration.md) |
| P3-2 | docs/02 checkout 流程「无渠道专属表」与 docs/03（creem_orders/waffo_orders 已建，迁移 0007）矛盾 | P3 | [02 §2 业务流程第 6 步](./02-api-reference.md) |
| P3-3 | Creem `discountCode`/Dashboard 折扣与迁移 0010 金额精确比对互斥未声明（Stripe 有显式决策，Creem 缺同款） | P3 | [creem §3.2](./payment/creem-integration.md) |
| P3-4 | 对外 sk- API 与 CSRF/CORS 边界未定义：middleware 豁免清单未列 `/api/v1/*`，非浏览器 Bearer 调用行为无文档 | P3 | [02 §认证机制](./02-api-reference.md) + [boundary-spec §三](./boundary-spec.md) |
| P3-5 | 文档卫生：docs/16 出现两个「五」章（已改六/七）；组件计数三方漂移（README/docs/01 28 个 vs docs/06 29 个，已对齐并声明唯一清点处）；docs/01 §7 查看积分口径漏负数分支（已补全口径） | P3 | [16 章节号](./16-observability-alerting.md) + [06 文首](./06-components.md) + [README 索引行](./README.md) + [01 §7](./01-architecture.md) |
| P3-6 | `prompt.length / 4` 对中文输入低估 token 2–4 倍（目标市场含 zh），低估方向对平台不利（一次扣清不补收） | P3 | [13 决策 2](./13-ai-gateway.md) |
| P3-7 | GDPR 待补清单未覆盖 op_events.subject_uuid 与 audit_logs 的个人数据处置 | P3 | [04 §8 第 6 条](./04-auth-flow.md) |
| P3-8 | new_user 注册奖励（10 积分）可被一次性邮箱批量刷取；防刷边界表原先只覆盖匿名层 | P3 | [14 §五](./14-anonymous-trial.md) |
| 附注 | 回写时新发现：docs/05 §2.1 公式正数分支缺 `expired_at IS NULL`，长期有效正数余额会被 SQL 三值逻辑排除导致少算；已按 docs/03 口径修正两处公式 | P3 | [05 §2.1](./05-payment-credits-flow.md) |

> 上线顺序建议：P1-A 与 P2-C 代价极小（一处 `after()` 纪律 + 一行事件订阅），建议并入第九轮清单第 7 步一起做；
> 其余 P2/P3 均为文档收口级改动，随第九轮第 15 步一并完成即可。资金类 P0 仍以第九轮清单为准。
