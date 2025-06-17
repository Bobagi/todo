# Multi-stage Dockerfile for Node backend and React frontend

# Backend build stage
FROM node:18 AS backend
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install
COPY server ./server

# Frontend build stage
FROM node:18 AS frontend
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client ./client
RUN cd client && npm run build

# Final stage
FROM node:18-alpine
WORKDIR /app
COPY --from=backend /app/server ./server
COPY --from=frontend /app/client/build ./server/public
EXPOSE 3000
CMD ["node", "server/index.js"]
