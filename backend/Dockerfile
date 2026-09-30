FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/wait-db.sh /app/wait-db.sh
RUN chmod +x /app/wait-db.sh
EXPOSE 4000
# wait-db.sh：等待数据库 → 自动建表+种子（仅空库）→ 启动后端
WORKDIR /app
CMD ["./wait-db.sh"]
