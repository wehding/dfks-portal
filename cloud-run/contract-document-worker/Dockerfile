FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ghostscript \
    ocrmypdf \
    poppler-utils \
    qpdf \
    tesseract-ocr-dan \
    tesseract-ocr-eng \
    unpaper \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs ./

ENV NODE_ENV=production PORT=8080
USER node
CMD ["npm", "start"]
