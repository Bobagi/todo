FROM node:18-alpine

WORKDIR /app

COPY . .

RUN npm install

RUN cp app.js public/

EXPOSE 3000

CMD ["node", "server.js"]
