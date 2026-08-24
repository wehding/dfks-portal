FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    python3-pikepdf \
    python3-reportlab \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs processor.mjs backfill.mjs google-secure-api.mjs spatial-ocr.mjs vision_overlay.py ./

ENV NODE_ENV=production PORT=8080
USER node
CMD ["npm", "start"]
