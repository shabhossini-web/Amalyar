# ── build ──────────────────────────────────────────────
FROM node:22-alpine AS build
# Prisma روی Alpine به libssl/openssl نیاز دارد وگرنه موتورش لود نمی‌شود
RUN apk add --no-cache openssl
WORKDIR /app
# شبکهٔ سرور کند/ناپایدار است → retry و timeoutِ بالا تا npm install نیفتد
RUN npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 300000 \
 && npm config set fetch-timeout 600000
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build

# ── run ────────────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
# migrate deploy سپس اجرا (schema همیشه به‌روز)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
