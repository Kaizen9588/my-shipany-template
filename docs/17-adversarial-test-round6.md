# 第六轮对抗性测试报告（2026-08-17，全功能模块）

> 本轮对**全部功能模块**做了一轮独立对抗性测试：静态代码审查（鉴权/积分/支付/AI 网关/
> 后台/控制台/中间件/Cron）+ 动态 HTTP 攻击测试（未认证面 + 三种角色会话面：
> super_admin / operator / user，含封禁与删除态）+ 浏览器 UI 走查（后台与控制台全页面）。
>
> 复现环境：`next start`（生产模式，`AUTH_TRUST_HOST=true`），本地开发库（Supabase）。
> 结论格式：✅ 已修复（含提交位置）｜❌ 否决（含理由）｜⬜ 待办（含优先级）。

---

## 一、发现并已修复（✅）

| # | 严重度 | 问题 | 复现 | 修复位置 |
|---|--------|------|------|----------|
| H1 | **高** | **管理员加积分功能完全不可用**：`adjustCreditsByAdmin` 正数分支 `expired_at` 传 `""`（空字符串），Postgres `timestamptz` 解析失败（22007）。API（`POST /api/admin/user/credits`）与后台 UI（`/admin/credits/adjust`）双路径报错，管理员永远无法给用户加积分 | 动态：admin 会话调 API 返回 `adjust credits failed`；浏览器提交表单出现 Next 错误页；服务端日志 `invalid input syntax for type timestamp with time zone: ""` | `services/credit.ts`（正数 expired_at 改 NULL = 长期有效，与 decrease_credits RPC 的 NULL 语义一致）+ `models/credit.ts`（`getUserValidCredits` 过滤补 `expired_at.is.null`，与 RPC 余额口径一致）+ `__tests__/credit.test.ts` 回归用例 |
| H2 | **高** | **API Key 创建完全不可用**：代码写入 `key_prefix` 列，但 `apikeys` 基线表没有该列 → PostgREST 42703。控制台「Create API Key」永远失败，整个 API Key 模块（P-1.5 哈希存储卖点）不可用 | 动态：`apikeys` 表 `select` 报 `column apikeys.key_prefix does not exist`；UI 点击 Create 无反应 | 迁移 `data/migrations/0015_apikeys_key_prefix.sql`（补列 + `idx_apikeys_user_uuid` 索引） |
| M1 | 中 | **`/api/admin/payment-settings` PUT 定价无 >0 校验**：与 `/api/admin/payment-products` 规则不一致，可把商品金额改成 0（甚至负数）→ 结算 0 元、webhook 金额比对 0==0 通过 → **免费送积分**的资损配置。虽然需 admin 权限，但属于「一个入口校验、另一个入口不校验」的典型资金漏洞 | 动态：PUT `amount:0` 成功（`updated:true`），DB 中 starter 金额变 0；同请求到 payment-products 被拒（`amount must be > 0`） | `app/api/admin/payment-settings/route.ts`（补 amount/credits/valid_months > 0 校验） |
| M2 | 中 | **被封禁/已删除用户会话仍然有效**：所有用户 API（`/api/ping`、`/api/v1/ai/generate`、`/api/checkout`、`get-user-info`…）与控制台布局只校验「有 uuid/email」，不校验 `users.status`；仅 admin 面板（`getAdminUser`）拦截。JWT 会话不随封禁吊销 → banned 用户可继续消耗积分；delete-account 后旧会话仍可用（仅登录被密码清除阻断） | 动态：admin 把 user 置 `banned` 后，该用户会话调 `/api/ping` 仍到达积分扣减环节、`get-user-info` 正常返回；delete-account 后旧会话 `get-user-info` 仍返回数据 | `services/user.ts` `getUserUuid()`（session 用 jwt 回调实时刷新的 status 拦截；API Key 路径查库校验 status）+ `app/[locale]/(default)/(console)/layout.tsx`（banned/deleted → redirect 登录页） |
| M3 | 中 | **AI 网关 `max_tokens` 未校验/未封顶**：负数被当 truthy 传入（`max_tokens || max_output`），`estimateCredits` 算出负值后 `Math.max(1,…)` 退化为**只扣 1 积分**；若渠道对非法 max_tokens 静默 clamp 到上限，用户即以 1 积分获得完整输出（计费绕过）。超大值同样无上限 | 静态：`estimateCredits(-1000000)` → 1；动态：修复前 `402 required:1`（见验证） | `app/api/v1/ai/generate/route.ts`（max_tokens 服务端 clamp 到 `[1, pricing.max_output_tokens]`） |
| L1 | 低中 | **头像上传接受任意 `image/*`**（含 `image/svg+xml`）+ 扩展名/Content-Type 全部客户端可控 → SVG 内嵌脚本的存储域 XSS 向量（自 XSS/存储域）；上传的 HTML 伪装 image 也可被 S3 按客户端 Content-Type 提供 | 静态：`file.type.startsWith("image/")` 通过；`ext` 取自文件名 | `app/api/user/avatar/route.ts`（魔数校验 png/jpeg/gif/webp + 服务端决定 ext/Content-Type，拒绝 SVG/HTML） |
| L2 | 低 | **匿名演示额度 off-by-one**：RPC 达到上限返回 `p_limit`，路由 `count >= dailyLimit` 判断 → `ANONYMOUS_DAILY_LIMIT=3` 实际只放行 2 次；且「正好到上限」与「已被拒」返回值相同无法区分 | 静态分析 + RPC 语义推演 | 迁移 `data/migrations/0016_anonymous_usage_off_by_one.sql`（达上限返回 NULL）+ `app/api/v1/ai/demo/route.ts`（NULL → 429） |
| L4 | 低 | **备份在存储未配置时仍实例化 S3 客户端**：空 endpoint/credentials 下 AWS SDK 尝试解析默认端点，曾导致 `/api/cron/daily`（dev 无 CRON_SECRET 可任意触发）长时间挂起、整机不可响应（本轮测试中真实复现一次，原服务因此重启） | 动态：触发 cron 后服务对所有请求（含 /api/health）无响应，重启恢复 | `lib/backup.ts`（STORAGE_BUCKET 未配置直接跳过，不实例化 S3）+ 测试 |
| L5 | 低 | `getPaidOrders` 分页 range 闭区间每页多取一条 | 静态 | `models/order.ts`（end 改 `page*limit-1`） |

> **覆盖补全注记（2026-08 对抗式审查 M4）**：上表 H1 当时仅修复 `adjustCreditsByAdmin`，同源缺陷在
> `increaseCredits` 仍保留 `expired_at || ""`（新用户赠分等路径同受 22007 影响）。已于 2026-08 一并修复：
> `services/credit.ts` increaseCredits 空值改存 NULL + `__tests__/credit-service.test.ts` 回归用例。

## 二、动态验证结论（未发现问题，避免重复怀疑）

| # | 验证项 | 结论 |
|---|--------|------|
| 1 | CSRF 防护（middleware） | ✅ 非 GET API 带恶意 Origin → 403；无 Origin（curl/服务端）放行；webhook/cron 豁免；OPTIONS 预检 204 |
| 2 | 未认证 API 面 | ✅ admin 全部 403 / 401；AI generate 401；demo 限流；get-user-info 无 auth |
| 3 | RBAC 分级 | ✅ operator 可看板/查询，调积分/改角色/封禁/退款全部 403；普通 user 全 403；admin 不能改 super_admin 账号；`requireAdmin(level)` 实时查库拦 banned 管理员 |
| 4 | 金额单一真相源 | ✅ checkout 忽略客户端金额/积分（服务端定价）；非法 product_id 拒绝；`payment_settings` 全启用但 Stripe 私钥为空 → 正确报「no payment provider available」（配置驱动，非漏洞） |
| 5 | Webhook 验签 | ✅ 伪造 Stripe/Creem/Waffo 签名全部拒绝（分别 500/500/`{"message":"failed"}`），无法触达落账逻辑；Waffo 有 10s 超时兜底（2.11 已落地） |
| 6 | 验证码/登录爆破防护 | ✅ 邮箱+IP 双维度限流（verify-code 5/分、20/分；send-verification 60s 冷却+日上限）；验证码哈希存储、原子消费防一码多用；登录失败锁定 |
| 7 | AI 模型白名单 | ✅ 白名单外 model → 400；白名单内未配凭证 → 500（不扣费） |
| 8 | 邀请体系 | ✅ 自邀拦截、重复绑定拦截、code 冲突拦截、绑定落 affiliate 记录（pending） |
| 9 | 通知 IDOR | ✅ `markNotificationsRead` 按 session user_uuid + uuid 双重限定，跨用户 uuid 无效果 |
| 10 | 博客 XSS | ✅ markdown-it 默认转义 HTML（`<script>`/`<img onerror>` 文本化）、`javascript:` 链接被剥除（动态注入测试贴验证），无 dangerouslySetInnerHTML 漏洞 |
| 11 | 密码策略 | ✅ 强度校验（≥8 位字母+数字）、改密必须验旧密码、删除后密码登录被阻断（redirect 到 CredentialsSignin 错误） |
| 12 | GDPR 删除 | ✅ 软删除 + 匿名化 email + 清 password_hash/signin_openid/ip + 撤销 API Key（但旧会话仍有效 —— 已被 M2 修复） |
| 13 | 环境变量/泄露面 | ✅ NEXT_PUBLIC_* 全公开性质；toSafeUser 白名单出口；备份字段收敛 |
| 14 | 限流/健康检测 | ✅ 渠道连续失败 5 次/10min → unhealthy 30min failover；Upstash 未配置时用户日配额静默放行（已知决策，文档已注明） |

## 三、待办（⬜，本轮未改，均低优先级）

| # | 项 | 说明 | 优先级 |
|---|----|------|--------|
| T1 | PostgREST `.or()` 过滤注入面 | `/api/search`、admin 用户/订单搜索把关键词拼进 `.or()` 过滤串；动态验证影响仅限查询内语法（无法越权/绕过 published 过滤），但仍是 filter 语法注入面。建议转 `ilike` 参数化或做 `%`/`,`/`(`/`)` 转义 | 低 |
| T2 | `generateCode` 可能产出 <6 位验证码 | `getNonceStr(6)` 取数字后可能不足 6 位（如 5 位 → 1e5 空间），虽有限流兜底，建议直接 `randomInt(0, 1e6)` 补零 | 低 |
| T3 | `rateLimitUser` Upstash 未配置时静默 `{ok:true}` | 已在 docs/12 2.12-⑤ 登记决策；保持 | 信息 |
| T4 | dev 模式 `/api/cron/daily` 无鉴权 | 生产已 fail-fast（CRON_SECRET 必填）；dev 保留无密钥执行便于本地测试，但 L4 修复后不再有挂起风险 | 信息 |
| T5 | 环境问题记录：`next start` 未设 `AUTH_TRUST_HOST=true` 时 NextAuth 全线 `UntrustedHost`（登录页死循环跳首页、session 接口报配置错误） | README 已注明；本轮为复测临时加 `AUTH_TRUST_HOST=true` 启动。建议 `.env.example` 增加注释或在非 Vercel 环境自动探测 | 信息/文档 |

## 四、验证摘要（修复后）

- `pnpm tsc --noEmit` ✅ / `pnpm lint`（改动文件 0 error）✅ / `vitest run` **154 通过**（原 151 + 新增回归 3）✅
- H1 动态验证：admin 加积分 API 成功、DB 写入 expired_at NULL、余额可查、后台 UI 表单成功跳转（注：同源缺陷在 increaseCredits 的覆盖见 H1 行末 M4 注记）
- H2 动态验证：新建 API Key 成功入库（key_prefix 落列），Bearer 调用 /api/v1/ai/generate 到达计费环节
- M2 动态验证：banned 用户会话调 API 返回 no auth；控制台页面重定向登录
- M3 动态验证：`max_tokens:-1000000` 的 402 响应 `required` 从 1 变为按 4096 上限估算（10）

---

## 五、第七轮续审补充（2026-08-20，qoder better-harness 意见 + 待办收尾）

> 原第六轮中断后继续。处理了三类来源：① 第六轮「待办」T1/T2；② 外部 qoder better-harness
> 对抗审查意见（`.qoder/better-harness/...`）；③ 对 AGENTS.md / logger 声明的管线脱节修正。

### 5.1 待办收尾

| 来源 | 项 | 结论 |
|---|---|---|
| T1（第六轮） | PostgREST `.or()` 过滤注入面 | ✅ 已修：新增 `lib/postgrest.ts` `safeLikeValue()` / `likeFilter()`，`/api/search`、`searchPaidOrders`、`searchUsers` 统一改用它；剥离 `,()"'`\`%_` 等过滤语法/通配符，附带单测 |
| 续审 | `/api/search` 用 `published` 过滤博客 | ✅ 已修：posts 表线上状态是 `online`，搜索端点此前永远查空；改为 `PostStatus.Online` 并加单测（另含注入剥离断言） |
| T2（第六轮） | `generateCode` 可能 <6 位 | ✅ 已修：改用 `crypto.randomInt(0,1_000_000)` + `padStart(6,"0")`，恒定 1e6 空间、无偏；更新/新增单测 |
| T3/T4/T5 | 已登记保持 | 维持第六轮结论不变（Upstash 缺省放行、dev cron 免密钥、AUTH_TRUST_HOST 文档提示） |

### 5.2 qoder better-harness 意见处理

| 意见 | 严重度 | 处理 |
|---|---|---|
| checkout 入口编排层缺聚焦测试 | Medium | ✅ 已补 `__tests__/checkout-route.test.ts`（cancel_url 同源、早期失败分支、不触达渠道/订单）+ `__tests__/checkout-failure-oplog.test.ts`（失败分支 op 事件绑定 order_no） |
| checkout 失败现场无法关联订单 | Medium | ✅ 已在第六轮修复并补测试：`app/api/checkout/route.ts` 失败分支 `subject_uuid`/`detail` 绑定 `order_no`，日志改 `logger.error(e,{route,order_no})`；本轮复核通过 |
| AGENTS.md 没有项目入口 | Low | ✅ 已补 `BEGIN:project-doc` 区块：路由到 `docs/boundary-spec.md`、`docs/README.md`、README 与常用命令 |
| logger 声明与事实脱节 | Low | ✅ 已收敛：checkout 与三个支付 webhook 失败路径接 `@/lib/logger`；`lib/logger.ts` 注释改为渐进收敛口径，不再宣称「全部统一」 |
| qmind 插件同名/能力指纹重叠 | Low | 不属本仓库；`.qoder` 插件缓存外部配置，建议在禁用/整合 qmind 插件时处理，本轮不改 |

### 5.3 续审新增对抗项

| 项 | 结论 |
|---|---|
| `models/anonymous-usage.ts` 清理函数是否有接线 | ✅ 已挂 `/api/cron/daily`（`cleanupAnonymousUsage(30)`）+ 文档 16/后台 cron 说明 |
| 迁移 0017（expired 恢复 + 被邀请人仅首笔付费） | 代码/注释完整、幂等；`NOT EXISTS` + 部分唯一索引双保险；<br>**尚未在运行库 apply**（是否需要上线按部署节奏决定，勿与本地测试混跑） |
| `dangerouslySetInnerHTML` 3 处 | ✅ 均为服务端可控内容/已转义的 markdown，无用户 HTML 注入路径 |
| 遗留 `Math.random` | 仅 `lib/hash.ts getUniSeq`（当前无调用方，非安全敏感域）；API key / 验证码已改用 `crypto.randomInt` |

### 5.4 验证摘要（第七轮）

- `pnpm tsc --noEmit` ✅ / `npx eslint`（本轮改动文件）0 errors ✅
- `pnpm test` **43 文件 / 179 用例全绿**（新增 percentage / postgrest / search-online / checkout 等）
- 未 apply `0017` 到运行库，避免与本地/生产数据混跑；迁移文件随仓库提交，部署时由迁移机制幂等执行
