#!/bin/bash
set -euo pipefail
umask 077
cd /opt/ritech
chmod 700 /opt/ritech
# Invoked by SSM after private artifacts and Secrets Manager values are available.
REGION=us-east-2
BUCKET="$1"
SECRET="$2"
PUBLIC_IP="$3"
aws s3 cp "s3://$BUCKET/release/backend.tar" backend.tar --region "$REGION" --only-show-errors
aws s3 cp "s3://$BUCKET/release/web.tar" web.tar --region "$REGION" --only-show-errors
aws secretsmanager get-secret-value --secret-id "$SECRET" --region "$REGION" --query SecretString --output text > app.env
chmod 600 app.env
docker load -i backend.tar
mkdir -p web tls/postgres tls/redis tls/backend letsencrypt acme postgres redis nginx
tar xf web.tar -C web
docker network inspect ritech >/dev/null 2>&1 || docker network create ritech
if [ ! -f tls/ca.crt ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 365 -keyout tls/ca.key -out tls/ca.crt -subj '/CN=RiTech Demo Internal CA' >/dev/null 2>&1
  for service in postgres redis backend; do
    openssl req -newkey rsa:2048 -nodes -keyout "tls/$service/server.key" -out "tls/$service/server.csr" -subj "/CN=$service" >/dev/null 2>&1
    printf 'subjectAltName=DNS:%s,DNS:localhost\nextendedKeyUsage=serverAuth\n' "$service" > "tls/$service/ext.cnf"
    openssl x509 -req -in "tls/$service/server.csr" -CA tls/ca.crt -CAkey tls/ca.key -CAcreateserial -days 90 -out "tls/$service/server.crt" -extfile "tls/$service/ext.cnf" >/dev/null 2>&1
    cp tls/ca.crt "tls/$service/ca.crt"
  done
fi
chmod 755 tls tls/postgres tls/redis tls/backend
chmod 644 tls/ca.crt tls/*/*.crt
chown 70:70 tls/postgres/server.key
chown 999:999 tls/redis/server.key
chown 100:101 tls/backend/server.key
chmod 600 tls/*/server.key
DB_PASSWORD=$(sed -n 's/^DB_PASSWORD=//p' app.env)
REDIS_PASSWORD=$(sed -n 's/^REDIS_PASSWORD=//p' app.env)
printf 'POSTGRES_DB=ritech\nPOSTGRES_USER=ritech\nPOSTGRES_PASSWORD=%s\n' "$DB_PASSWORD" > postgres.env
printf 'port 0\ntls-port 6379\ntls-cert-file /tls/server.crt\ntls-key-file /tls/server.key\ntls-ca-cert-file /tls/ca.crt\ntls-auth-clients no\ntls-protocols "TLSv1.3"\nrequirepass %s\nappendonly yes\nmaxmemory 192mb\nmaxmemory-policy noeviction\n' "$REDIS_PASSWORD" > redis.conf
chmod 644 redis.conf
docker inspect ritech-postgres >/dev/null 2>&1 || docker run -d --name ritech-postgres --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 --network ritech --network-alias postgres --env-file postgres.env -v "$PWD/postgres:/var/lib/postgresql/data" -v "$PWD/tls/postgres:/tls:ro" postgres:16-alpine -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c ssl_min_protocol_version=TLSv1.3 -c ssl_max_protocol_version=TLSv1.3 -c 'hba_file=/var/lib/postgresql/data/pg_hba.conf'
for i in $(seq 1 60); do docker exec ritech-postgres pg_isready -U ritech -d ritech >/dev/null 2>&1 && break; sleep 2; done
# Keep local Unix-socket maintenance; network access is TLS with password only.
printf 'local all all trust\nhostssl all all all scram-sha-256\nhostnossl all all all reject\n' > postgres/pg_hba.conf
chown 70:70 postgres/pg_hba.conf
chmod 600 postgres/pg_hba.conf
docker exec ritech-postgres psql -U ritech -d ritech -c 'SELECT pg_reload_conf();' >/dev/null
docker inspect ritech-redis >/dev/null 2>&1 || docker run -d --name ritech-redis --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 --network ritech --network-alias redis -v "$PWD/redis:/data" -v "$PWD/tls/redis:/tls:ro" -v "$PWD/redis.conf:/usr/local/etc/redis/redis.conf:ro" redis:7-alpine redis-server /usr/local/etc/redis/redis.conf
if docker inspect ritech-backend >/dev/null 2>&1; then docker stop ritech-backend >/dev/null; docker rm ritech-backend >/dev/null; fi
docker run -d --name ritech-backend --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 --network ritech --network-alias backend --env-file app.env -v "$PWD/tls/backend:/tls:ro" ritech-backend:aws-demo
# HTTP exposes only the ACME challenge and an HTTPS redirect, never the app/API.
cat > nginx/http.conf <<'EOF'
server { listen 80; server_name _;
 location /.well-known/acme-challenge/ { root /var/www/acme; }
 location / { return 301 https://$host$request_uri; }
}
EOF
chmod 755 nginx web acme letsencrypt
chmod 644 nginx/http.conf
docker inspect ritech-http >/dev/null 2>&1 || docker run -d --name ritech-http --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 -p 80:80 -v "$PWD/nginx/http.conf:/etc/nginx/conf.d/default.conf:ro" -v "$PWD/acme:/var/www/acme:ro" nginx:stable-alpine
docker run --rm -v "$PWD/letsencrypt:/etc/letsencrypt" -v "$PWD/acme:/var/www/acme" certbot/certbot:v5.4.0 certonly --non-interactive --agree-tos --register-unsafely-without-email --preferred-profile shortlived --webroot -w /var/www/acme --ip-address "$PUBLIC_IP"
cat > nginx/https.conf <<EOF
server { listen 443 ssl; server_name $PUBLIC_IP;
 ssl_certificate /etc/letsencrypt/live/$PUBLIC_IP/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/$PUBLIC_IP/privkey.pem;
 ssl_protocols TLSv1.3;


 add_header X-Content-Type-Options nosniff always;
 add_header X-Frame-Options DENY always;
 root /usr/share/nginx/html;
 location / { try_files \$uri \$uri/ /index.html; }
 location ~ ^/(api/|socket.io/|health|market-data|telemetry|atr|notifications|hedging) {
  proxy_pass https://backend:3000;
  proxy_ssl_verify on; proxy_ssl_trusted_certificate /tls/ca.crt;
  proxy_ssl_server_name on; proxy_ssl_name backend; proxy_ssl_protocols TLSv1.3;
  proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade";
  proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 120s;
 }
}
EOF
chmod 644 nginx/https.conf
docker inspect ritech-web >/dev/null 2>&1 || docker run -d --name ritech-web --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 --network ritech -p 443:443 -v "$PWD/nginx/https.conf:/etc/nginx/conf.d/default.conf:ro" -v "$PWD/web:/usr/share/nginx/html:ro" -v "$PWD/letsencrypt:/etc/letsencrypt:ro" -v "$PWD/tls/ca.crt:/tls/ca.crt:ro" nginx:stable-alpine
docker exec ritech-web nginx -t
docker exec ritech-web nginx -s reload
cat > /usr/local/sbin/ritech-renew <<'EOF'
#!/bin/bash
set -euo pipefail
cd /opt/ritech
chmod 700 /opt/ritech
docker run --rm -v "$PWD/letsencrypt:/etc/letsencrypt" -v "$PWD/acme:/var/www/acme" certbot/certbot:v5.4.0 renew --non-interactive
docker exec ritech-web nginx -s reload
EOF
chmod 700 /usr/local/sbin/ritech-renew
printf '[Unit]\nDescription=Renew RiTech public IP certificate\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/ritech-renew\n' > /etc/systemd/system/ritech-renew.service
printf '[Unit]\nDescription=Check RiTech certificate twice daily\n[Timer]\nOnCalendar=*-*-* 00,12:00:00\nRandomizedDelaySec=1800\nPersistent=true\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/ritech-renew.timer
systemctl daemon-reload
systemctl enable --now ritech-renew.timer
docker ps --format '{{.Names}} {{.Status}}'
