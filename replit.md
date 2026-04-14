# Question Bank - PDF Question Paper Scraper

## Overview

A full-stack web application that scrapes previous year question papers from PDFs, extracts questions with options and answers, and stores them in a PostgreSQL database. Handles both text-based PDFs and figure/image-based questions (math diagrams, reasoning figures).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (Replit dev) / Hono on Cloudflare Pages Functions (CF deployment)
- **Database**: PostgreSQL (Neon) + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **PDF Processing**: Poppler CLI (`pdftotext`, `pdftoppm`) + OCR (Replit) / `unpdf` pure-JS (Cloudflare)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for Express)

## Architecture

### PDF Processing Pipeline
1. **PDF Upload** - User uploads PDF via the web interface or processes pre-attached files
2. **Text Extraction** - Datalab Marker API can convert PDFs to markdown for high-quality extraction; local fallback uses `pdftotext -layout`, `pdf-parse`, and OCR (Replit) / `unpdf` (CF Pages)
3. **Format Detection** - Auto-detects PDF format (2016 style vs 2025 style)
4. **Question Parsing** - Regex-based parser extracts questions, options, answers
5. **Figure Capture** (Replit only) - Each question is cropped from the original PDF using pdftoppm + ImageMagick; watermarks removed via `-level 5%,78%`
6. **Background Processing** - Upload returns immediately; extraction runs in background; frontend polls `/api/papers/:id` every 2s

### Supported PDF Formats
- **Format 2016**: Questions with `Question ID`, `Status`, `Chosen Option` fields
- **Format 2025**: Questions with direct `Q.N` numbering and `A./B./C./D.` options

### Batch ZIP Processing
- User uploads a ZIP (up to 1 GB) via **Batch ZIP Upload** page
- ZIP goes directly from browser → Backblaze B2 (S3-compatible presigned URL) — server never holds the upload in memory
- Backend downloads ZIP from B2, extracts each PDF, processes them **sequentially** (OCR is CPU-heavy), then deletes the ZIP from B2 in a cleanup step so storage stays free
- Each PDF gets its own `batch_items` row with real-time stage tracking
- Frontend polls `/api/batch/:jobId` every 2.5s; localStorage persists the job ID across refreshes

### Database Schema
- `papers` - Exam papers (exam name, year, shift, total questions, processingStatus, processingStage, processingError)
- `questions` - Individual questions (text, options A-D, correct answer, figure flag, notes)
- `batch_jobs` - ZIP batch jobs (zipObjectPath, totalFiles, processedFiles, failedFiles, status)
- `batch_items` - Individual PDFs within a batch job (fileName, status, processingStage, questionsExtracted, paperId)

### Object Storage
- Backblaze B2 S3-compatible storage is used for batch ZIP uploads
- Required config: `B2_BUCKET`, `B2_REGION` or `B2_ENDPOINT`; required secrets: `B2_KEY_ID`, `B2_APPLICATION_KEY`
- Server files: `artifacts/api-server/src/lib/b2Storage.ts`, `routes/storage.ts`, `routes/batch.ts`
- Client lib: `lib/object-storage-web/`

### Marker API Integration
- Upload page supports selecting **Marker API** or **Local OCR** as the extraction engine.
- Marker uses Datalab's current `POST /api/v1/convert` endpoint, then polls `request_check_url` until conversion is complete.
- Required secret: `MARKER_API_KEY` (or `DATALAB_API_KEY` as a fallback name).
- Server files: `artifacts/api-server/src/lib/marker.ts`, `artifacts/api-server/src/routes/marker.ts`, and `artifacts/api-server/src/routes/papers.ts`.
- Health check: `GET /api/marker/health` checks Marker availability without exposing the key.
- Batch ZIP Upload also supports the same **Marker API** vs **Local OCR** selection; the selected provider is passed to `/api/batch/start`.
- Paper detail and question list views render question text/options/notes with Markdown-style emphasis and KaTeX for LaTeX delimiters such as `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`.

## AI Extract (Gemini Integration)

A new **AI Extract** tab uses Google Gemini AI with a hybrid strategy to clean up and re-structure questions:

### Hybrid Strategy
1. **Gemini 2.5 Flash** — Processes the full `full_pdf_text` for all questions. Fast and cost-efficient.
2. **Gemini 2.5 Pro** — Re-processes only questions that Flash flags as `needsProReview: true` (complex math, multi-step reasoning, diagram references). Accuracy is preserved at Pro level while keeping costs low.

### Features
- LaTeX rendering (via KaTeX) for all math and reasoning questions — inline `$...$` and block `$$...$$`
- SSE streaming for live progress updates on the frontend
- Saves cleaned full text back to `full_pdf_text` column
- Questions saved with structured fields: `questionText`, `optionA–D`, `correctAnswer`, `subject`, `note` (detailed explanation)
- `aiExtractionStatus`, `aiExtractionError`, `aiExtractionModel` columns on papers table track extraction state

### New Files
- `artifacts/api-server/src/routes/ai-extract.ts` — SSE streaming extraction route
- `artifacts/question-bank/src/pages/ai-extract.tsx` — Frontend page with LaTeX rendering
- `lib/integrations-gemini-ai/` — Gemini AI client (provisioned via Replit AI Integrations)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes to Neon DB
- `pnpm --filter @workspace/question-bank run build:cf` — build for Cloudflare Pages deployment

## Replit Runtime

- Replit services are registered as separate artifacts:
  - `artifacts/question-bank` serves the React frontend at `/`
  - `artifacts/api-server` serves the Express API at `/api`
  - `artifacts/mockup-sandbox` serves canvas/component previews at `/__mockup`
- The frontend Vite dev server requires `PORT` and `BASE_PATH`, allows Replit preview hosts, and proxies `/api` requests to the API server on port `8080`.
- Gemini access is provisioned through Replit AI integration environment variables (`AI_INTEGRATIONS_GEMINI_BASE_URL`, `AI_INTEGRATIONS_GEMINI_API_KEY`), while still supporting a user-provided `GEMINI_API_KEY` if present.
- The legacy combined `Start application` workflow was removed to avoid duplicate frontend/API processes and port conflicts.

## Key Files

- `lib/db/src/schema/questions.ts` — Database schema (papers + questions tables)
- `artifacts/api-server/src/lib/pdf-parser.ts` — PDF text extraction and question parsing (Replit/server)
- `artifacts/api-server/src/routes/papers.ts` — Express API routes (Replit)
- `artifacts/question-bank/functions/api/[[route]].ts` — Cloudflare Pages Function (CF deployment)
- `artifacts/question-bank/wrangler.toml` — Cloudflare Pages config
- `artifacts/question-bank/vite.config.cf.ts` — Vite config for CF Pages build
- `artifacts/question-bank/src/` — React frontend (dashboard, upload, papers, questions)
- `lib/api-spec/openapi.yaml` — API contract

## Cloudflare Pages Deployment

### Setup Steps
1. Push code to a GitHub repo
2. Go to Cloudflare Pages → Create a project → Connect GitHub repo
3. **Build settings**:
   - Root directory: `artifacts/question-bank`
   - Build command: `npm install -g pnpm && pnpm install --frozen-lockfile && pnpm --filter @workspace/question-bank run build:cf`
   - Output directory: `dist`
4. **Environment variables** (in CF Pages dashboard → Settings → Environment variables):
   - `NEON_DATABASE_URL` = your Neon PostgreSQL connection string
5. Deploy!

### CF vs Replit Differences
| Feature | Replit (Dev) | Cloudflare Pages |
|---------|-------------|-----------------|
| PDF text extraction | `pdftotext` (Poppler) | `unpdf` (pure JS) |
| Figure/image extraction | Yes (pdftoppm + ImageMagick + OCR) | **Not available** |
| Process attached PDFs | Yes | **Not available** |
| DB driver | `node-postgres` (persistent pool) | `@neondatabase/serverless` (HTTP) |
| API framework | Express 5 | Hono |
| Background processing | `setImmediate()` | `ctx.waitUntil()` |

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
