FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY public/portal/ /usr/share/nginx/html/portal/
COPY public/admin/ /usr/share/nginx/html/admin/

EXPOSE 80
