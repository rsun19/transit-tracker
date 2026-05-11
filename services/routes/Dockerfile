FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/routes/package.json ./services/routes/package.json

RUN npm install

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY services/routes ./services/routes

WORKDIR /app/packages/shared
RUN npm run build

WORKDIR /app/services/routes
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app/services/routes

COPY --from=builder /app/services/routes/dist ./dist
COPY --from=builder /app/services/routes/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY config/ /app/config/

EXPOSE 3002
CMD ["node", "dist/main.js"]

FROM builder AS development
CMD ["npm", "run", "start:dev"]
