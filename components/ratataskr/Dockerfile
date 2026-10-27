ARG MAIL_BASE=debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
FROM ${MAIL_BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install --no-install-recommends -y \
    nginx php8.4-fpm php8.4-cli php8.4-mbstring php8.4-xml php8.4-curl \
    php8.4-zip php8.4-intl php8.4-gd php8.4-sqlite3 ca-certificates openssl curl \
    && update-ca-certificates && rm -rf /var/lib/apt/lists/*
COPY components/ratataskr/server/security-baseline.sh /usr/local/bin/mail-baseline
RUN bash /usr/local/bin/mail-baseline \
    && mkdir -p /opt/ratataskr-snappymail \
    && curl --fail --location --proto '=https' --tlsv1.2 \
       https://github.com/the-djmaze/snappymail/releases/download/v2.38.2/snappymail-2.38.2.tar.gz -o /tmp/mail.tar.gz \
    && echo '71f1d8a9065cc9cf7ddd064f5c47cc7b255cb70e6a56713647fc73d4b79e33ec  /tmp/mail.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/mail.tar.gz -C /opt/ratataskr-snappymail --no-same-owner \
    && rm /tmp/mail.tar.gz
COPY components/ratataskr/themes/ratataskr /opt/ratataskr-snappymail/themes/ratataskr
COPY components/ratataskr/server/user-entry.php /opt/ratataskr-snappymail/user-entry.php
COPY components/ratataskr/container/ /etc/suite-mail/
RUN printf '%s\n' '<?php' "define('APP_DATA_FOLDER_PATH', '/var/lib/ratataskr-snappymail/');" > /opt/ratataskr-snappymail/include.php \
    && chown -R root:root /opt/ratataskr-snappymail \
    && chmod -R go-w /opt/ratataskr-snappymail \
    && install -d -o www-data -g www-data -m 0700 /var/lib/ratataskr-snappymail \
    && install -d -o www-data -g www-data -m 0700 /var/lib/ratataskr-snappymail/php-sessions \
    && php-fpm8.4 -t -y /etc/suite-mail/fpm.conf
USER 33:33
CMD ["php-fpm8.4", "-F", "-y", "/etc/suite-mail/fpm.conf"]
