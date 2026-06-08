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
# basePath is baked at build time; pass it (and the public mirror) as build args.
ARG BASE_PATH=""
ARG NEXT_PUBLIC_BASE_PATH=""
ENV BASE_PATH=$BASE_PATH
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure the bundled 7za binary is executable inside the Linux image.
RUN chmod +x node_modules/7zip-bin/linux/x64/7za node_modules/7zip-bin/linux/arm64/7za 2>/dev/null || true
RUN npm run build

# Runtime image: ships full node_modules so web, worker and tus can all run.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000 1080
CMD ["npm", "run", "start"]
