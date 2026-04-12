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
2. **Text Extraction** - `pdftotext -layout` extracts raw text from PDF, with `pdf-parse` fallback (Replit) / `unpdf` (CF Pages)
3. **Format Detection** - Auto-detects PDF format (2016 style vs 2025 style)
4. **Question Parsing** - Regex-based parser extracts questions, options, answers
5. **Figure Capture** (Replit only) - Each question is cropped from the original PDF using pdftoppm + ImageMagick; watermarks removed via `-level 5%,78%`
6. **Background Processing** - Upload returns immediately; extraction runs in background; frontend polls `/api/papers/:id` every 2s

### Supported PDF Formats
- **Format 2016**: Questions with `Question ID`, `Status`, `Chosen Option` fields
- **Format 2025**: Questions with direct `Q.N` numbering and `A./B./C./D.` options

### Batch ZIP Processing
- User uploads a ZIP (up to 1 GB) via **Batch ZIP Upload** page
- ZIP goes directly from browser → Google Cloud Storage (presigned URL) — server never holds the file in memory
- Backend streams ZIP from GCS, extracts each PDF, processes them **sequentially** (OCR is CPU-heavy)
- Each PDF gets its own `batch_items` row with real-time stage tracking
- Frontend polls `/api/batch/:jobId` every 2.5s; localStorage persists the job ID across refreshes

### Database Schema
- `papers` - Exam papers (exam name, year, shift, total questions, processingStatus, processingStage, processingError)
- `questions` - Individual questions (text, options A-D, correct answer, figure flag, notes)
- `batch_jobs` - ZIP batch jobs (zipObjectPath, totalFiles, processedFiles, failedFiles, status)
- `batch_items` - Individual PDFs within a batch job (fileName, status, processingStage, questionsExtracted, paperId)

### Object Storage
- Replit App Storage (Google Cloud Storage) used for ZIP uploads
- GCS bucket: `replit-objstore-c14d6db7-d667-4aa1-baa5-bd2e19a12d2f`
- Server files: `artifacts/api-server/src/lib/objectStorage.ts`, `objectAcl.ts`, `routes/storage.ts`
- Client lib: `lib/object-storage-web/`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes to Neon DB
- `pnpm --filter @workspace/question-bank run build:cf` — build for Cloudflare Pages deployment

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
