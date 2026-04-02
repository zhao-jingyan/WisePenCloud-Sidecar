# Stage 1: Builder
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /build
COPY package.json pnpm-lock.yaml ./
# 如果有 pnpm-workspace.yaml 也带上
COPY pnpm-workspace.yaml ./ 
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Stage 2: Runner
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /build/dist ./dist
# 可选：如果用到了 patches 里的内容，也需 COPY 过来
# COPY --from=builder /build/patches ./patches 

EXPOSE 9700
CMD ["node", "dist/index.js"]