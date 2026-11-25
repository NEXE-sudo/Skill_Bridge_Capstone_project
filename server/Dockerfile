FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY server/package*.json server/
COPY prisma ./prisma
RUN npm install

FROM base AS build
COPY server ./server
RUN npx prisma generate && npm run build -w server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/index.js"]
