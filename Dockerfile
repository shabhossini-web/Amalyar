# ── build stage ──────────────────────────────────────────────
# پایه‌ها از آینه‌ی گوگل (mirror.gcr.io) کشیده می‌شوند تا خطای 403/rate-limit
# داکرهاب پیش نیاید — این آینه همان ایمیج‌های رسمیِ library را بدون محدودیت سرو می‌کند.
FROM mirror.gcr.io/library/node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ── serve stage ──────────────────────────────────────────────
FROM mirror.gcr.io/library/nginx:alpine
RUN rm -rf /usr/share/nginx/html/* && rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
