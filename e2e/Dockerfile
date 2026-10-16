FROM mcr.microsoft.com/playwright:v1.63.0-noble

# TLS を復号する proxy 配下では npm ci が SELF_SIGNED_CERT_IN_CHAIN で落ちるため certs/palo-root.pem に CA を置く。無い環境では node が警告を 1 行出すだけ
COPY --from=common certs/ /opt/certs/
ENV NODE_EXTRA_CA_CERTS=/opt/certs/palo-root.pem

EXPOSE 9323
WORKDIR /app

COPY ./package*.json .
RUN npm ci

COPY . .
COPY --from=common ./tsconfig.json .
