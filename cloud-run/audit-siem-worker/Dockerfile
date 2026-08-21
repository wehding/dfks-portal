FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
USER node
ENV NODE_ENV=production PORT=8080
CMD ["node", "server.mjs"]
