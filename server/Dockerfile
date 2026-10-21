# ── build ──────────────────────────────────────────────
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
RUN npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 300000 \
 && npm config set fetch-timeout 600000
COPY package.json package-lock.json ./
# ⚠️ کشِ npm بیرون از لایه‌ها، روی دیسکِ خودِ سرور (id مشترک با Dockerfile.worker).
# Coolify کانتینرِ بیلدِ هر دیپلویِ هم‌زمان را با --add-host به docker build می‌دهد؛
# پس وقتی API و Worker با هم بیلد می‌شوند کشِ لایه‌ها همیشه می‌پرد و npm از صفر
# از خارج دانلود می‌کرد (۵ تا ۹ دقیقه). این mount به آن فلگ‌ها حساس نیست.
RUN --mount=type=cache,id=amalyar-npm-server,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund
COPY . .
RUN npm run build

# ── run ────────────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Prisma control client is generated outside Nest's TypeScript output.
COPY --from=build /app/src/generated ./dist/generated
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
# فقط دیتابیس مرکزی اینجا migrate می‌شود؛ migration دیتابیس شرکت‌ها با ابزار fleet انجام می‌شود.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/control/schema.prisma && node dist/main.js"]
