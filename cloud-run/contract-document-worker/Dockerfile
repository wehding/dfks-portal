FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    python3-pil \
    python3-pikepdf \
    python3-reportlab \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs processor.mjs backfill.mjs google-vision-api.mjs spatial-ocr.mjs tail-page-recovery.mjs resource-limits.mjs vision_overlay.py normalise_orientation.py ./

ENV NODE_ENV=production PORT=8080
USER node
CMD ["npm", "start"]

FROM runtime AS test
USER root
COPY *.test.mjs ./
ENV DFKS_CONTAINER_RUNTIME_TEST=1
CMD ["npm", "test"]

FROM runtime AS production
