FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/vehicles/package.json ./services/vehicles/package.json

RUN npm install

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY services/vehicles ./services/vehicles

WORKDIR /app/packages/shared
RUN npm run build

WORKDIR /app/services/vehicles
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app/services/vehicles

COPY --from=builder /app/services/vehicles/dist ./dist
COPY --from=builder /app/services/vehicles/package.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN rm -rf node_modules/@transit-tracker/shared && mkdir -p node_modules/@transit-tracker/shared
COPY --from=builder /app/packages/shared/dist node_modules/@transit-tracker/shared/dist
COPY --from=builder /app/packages/shared/package.json node_modules/@transit-tracker/shared/package.json
COPY config/ /app/config/

EXPOSE 3005
CMD ["node", "dist/main.js"]

FROM builder AS development
CMD ["npm", "run", "start:dev"]
