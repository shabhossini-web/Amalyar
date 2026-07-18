# ── build ──────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build

# ── run ────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
# migrate deploy سپس اجرا (schema همیشه به‌روز)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
