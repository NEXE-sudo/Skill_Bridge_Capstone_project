FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY server/package*.json server/
COPY prisma ./prisma
RUN npm ci

FROM base AS build
COPY server ./server
RUN npx prisma generate && npm run build -w server && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 4000
CMD ["node", "dist/index.js"]
