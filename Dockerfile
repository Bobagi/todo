FROM node:18-alpine

WORKDIR /app

# Ferramentas usadas no entrypoint
RUN apk add --no-cache openssl postgresql-client

# deps
COPY package*.json ./
RUN npm install && npm install prisma @prisma/client stripe

# prisma
COPY prisma ./prisma
RUN npx prisma generate || true

# código da app (inclui public/, server.js e /server/**)
COPY . .

# (REMOVIDO) não existe mais app.js na raiz para copiar
# RUN cp app.js public/

# entrypoint
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
