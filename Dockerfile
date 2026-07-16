# ── build stage ──────────────────────────────────────────────
# ایمیج‌های پایه از Docker Hub می‌آیند ولی روی سرور از آینه‌ی آروان
# (registry-mirror در daemon.json) کشیده می‌شوند — پس ۴۰۳/تحریم پیش نمی‌آید.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ── serve stage ──────────────────────────────────────────────
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/* && rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
