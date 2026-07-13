FROM nginx:alpine
COPY saas-landing.html /usr/share/nginx/html/index.html
EXPOSE 80
