FROM alpine:latest

RUN mkdir -p /etc/udhcpc ; echo 'RESOLV_CONF="no"' >> /etc/udhcpc/udhcpc.conf

RUN apk add --update nodejs npm su-exec shadow yt-dlp

RUN rm -rf /var/cache/apk/*

RUN mkdir /app
WORKDIR /app

COPY . .

RUN npm ci

RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
