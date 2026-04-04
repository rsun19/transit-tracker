# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app

COPY backend/package.json ./backend/package.json
COPY backend/package-lock.json ./backend/package-lock.json
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/nest-cli.json ./backend/nest-cli.json
COPY tsconfig.base.json ./
COPY config/ ./config/

WORKDIR /app/backend
RUN npm ci

COPY backend/src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app/backend

RUN apk add --no-cache curl

COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./

RUN npm ci --omit=dev

COPY config/ /app/config/

EXPOSE 3000
CMD ["node", "dist/main.js"]

# Stage 3: Development (used in dev override)
FROM builder AS development
CMD ["npm", "run", "start:dev"]
