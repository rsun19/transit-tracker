# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app

COPY frontend/package.json ./frontend/package.json
COPY frontend/package-lock.json ./frontend/package-lock.json
COPY frontend/tsconfig.json ./frontend/tsconfig.json
COPY tsconfig.base.json ./

WORKDIR /app/frontend
RUN npm ci

COPY frontend/src ./src
COPY frontend/next.config.mjs ./
COPY frontend/public/ ./public/

ARG BACKEND_URL=http://localhost:3000
ENV BACKEND_URL=$BACKEND_URL

RUN npm run build

# Stage 2: Production (standalone output)
FROM node:20-alpine AS production
WORKDIR /app/frontend

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static/
RUN mkdir -p ./public
COPY --from=builder /app/frontend/public/ ./public/

EXPOSE 3001
CMD ["node", "server.js"]

# Stage 3: Development (used in dev override)
FROM builder AS development
CMD ["npm", "run", "dev"]
