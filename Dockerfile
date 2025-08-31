FROM node:18-alpine

WORKDIR /app

# ferramentas que precisamos no entrypoint
RUN apk add --no-cache openssl postgresql-client

# deps
COPY package*.json ./
RUN npm install && npm install prisma @prisma/client stripe

# prisma client
COPY prisma ./prisma
RUN npx prisma generate || true

# código da app
COPY . .

# garante que o front referencie o app.js certo
RUN cp app.js public/

# script de boot
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
