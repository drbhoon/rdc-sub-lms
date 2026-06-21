FROM node:24-bookworm-slim AS dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

FROM dependencies AS builder
WORKDIR /app
COPY . .
ARG DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rdc_lms
ENV DATABASE_URL=$DATABASE_URL
RUN npm run db:generate && npm run build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress poppler-utils ffmpeg fonts-dejavu-core openssl procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
CMD ["npm", "run", "start:railway"]
