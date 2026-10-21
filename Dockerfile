# ── build stage ──────────────────────────────────────────────
# ایمیج‌های پایه از Docker Hub می‌آیند ولی روی سرور از آینه‌ی آروان
# (registry-mirror در daemon.json) کشیده می‌شوند — پس ۴۰۳/تحریم پیش نمی‌آید.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# کشِ npm بیرون از لایه‌ها روی دیسکِ سرور — دلیلش در server/Dockerfile.
RUN --mount=type=cache,id=amalyar-npm-web,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund
# میزبانِ کنسولِ Platform Admin و مبنای API در زمانِ build داخلِ باندل می‌نشینند
# (Vite متغیرهای VITE_* را از process.env در زمانِ build می‌خوانَد).
# پیش‌فرض‌ها را Coolify با Build Variable می‌تواند override کند.
# بعد از npm ci آمده تا عوض‌شدنِ این‌ها لایهٔ نصب را باطل نکند.
ARG VITE_PLATFORM_HOSTS=tenant.amalyar.com
ARG VITE_API_BASE=""
ENV VITE_PLATFORM_HOSTS=$VITE_PLATFORM_HOSTS
ENV VITE_API_BASE=$VITE_API_BASE
COPY . .
RUN npm run build

# ── serve stage ──────────────────────────────────────────────
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/* && rm -f /etc/nginx/conf.d/default.conf
# ⚠️ قالب، نه کانفیگ: entrypointِ ایمیج با envsubst پردازشش می‌کند تا نشانیِ
# بک‌اند در زمانِ اجرا تزریق شود. تزریقِ سئوی هر tenant از همین‌جا می‌گذرد.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# نامِ سرویسِ بک‌اند در همان شبکهٔ داکر. Coolify می‌تواند override کند؛ اگر
# اشتباه باشد فقط تزریقِ سئو خالی می‌ماند (SSI بی‌صدا) و سایت سرِ جایش است.
ENV API_UPSTREAM=http://amalyar-api:3001
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
