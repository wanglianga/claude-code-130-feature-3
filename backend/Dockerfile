FROM node:20-bookworm-slim

WORKDIR /app

# 依赖（利用层缓存）
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 源码
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# 启动：等待数据库 → 空库自动种子 → 启动 NestJS
CMD ["sh", "-c", "npx ts-node scripts/docker-bootstrap.ts && npx ts-node src/main.ts"]
