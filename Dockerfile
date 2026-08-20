# Next.js 16.3.1 要求 Node >= 20.9.0（见 next/package.json engines），node:18 会构建失败
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# 与 CI（pnpm/action-setup version: 11）对齐：锁定主版本，避免未锁版本的
# pnpm 与 lockfileVersion 不兼容导致 --frozen-lockfile 失败
RUN apk add --no-cache libc6-compat && yarn global add pnpm@11

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml* ./
RUN pnpm i --frozen-lockfile

# Rebuild the source code only when needed
FROM deps AS builder

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY . .
# NEXT_OUTPUT=standalone：仅 Docker 构建启用 standalone 输出（P-1.6）
RUN NEXT_OUTPUT=standalone pnpm build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir .next && \
    chown nextjs:nodejs .next

COPY --from=builder /app/public ./public
# data/migrations 必须进运行镜像：lib/migrate.ts 运行时 readdirSync 扫描该目录
# （nft 无法追踪 fs 动态读），缺了容器启动会因迁移 ENOENT 崩溃（对抗式复审 2 P2）
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV NODE_ENV production

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# server.js is created by next build from the standalone output
CMD ["node", "server.js"]