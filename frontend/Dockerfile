FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 浏览器直接访问后端地址；默认映射到宿主机 127.0.0.1:4000
ARG NEXT_PUBLIC_API=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API=$NEXT_PUBLIC_API
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./
EXPOSE 3000
CMD ["npm", "run", "start"]
