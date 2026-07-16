# ── serve pre-built static (build happens in CI / locally, نه روی سرور) ─────
# سرور به رجیستری‌های خارجی دسترسیِ پایدار ندارد (403/عدم دسترسی)، پس نه node
# می‌کشیم نه build روی سرور می‌کنیم. فقط با nginx:alpine (که از قبل روی سرور
# کش شده) خروجیِ آماده‌ی dist/ را سرو می‌کنیم — بدونِ دانلودِ ایمیجِ جدید.
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/* && rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
