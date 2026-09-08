FROM node:22-bookworm-slim
WORKDIR /opt/seed
COPY package.json tsconfig.json ./
RUN npm install -g trigger.dev@4.5.16 && npm install
COPY src ./src
COPY trigger-once.mjs ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
