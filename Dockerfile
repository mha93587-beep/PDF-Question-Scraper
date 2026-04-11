FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y \
  poppler-utils \
  imagemagick \
  tesseract-ocr \
  tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/question-bank/ ./artifacts/question-bank/
COPY attached_assets/ ./attached_assets/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/question-bank run build:railway

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
