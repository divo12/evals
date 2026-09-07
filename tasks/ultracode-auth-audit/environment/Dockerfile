FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY generate.mjs /tmp/generate.mjs
RUN WORKSPACE=/app node /tmp/generate.mjs && rm -f /tmp/generate.mjs
