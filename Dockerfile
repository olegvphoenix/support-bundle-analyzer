# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies (cached layer).
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Build the Next.js app.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Runtime image: ships full node_modules so web, worker and tus can all run.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000 1080
CMD ["npm", "run", "start"]
