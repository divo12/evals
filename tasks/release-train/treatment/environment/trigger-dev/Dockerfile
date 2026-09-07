FROM node:22-bookworm-slim
WORKDIR /opt/seed
COPY package.json ./
RUN npm install -g trigger.dev@latest && npm install
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
