# Question Bank - PDF Question Paper Scraper

## Overview

A full-stack web application that scrapes previous year question papers from PDFs, extracts questions with options and answers, and stores them in a PostgreSQL database. Handles both text-based PDFs and figure/image-based questions (math diagrams, reasoning figures).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL (Neon) + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **PDF Processing**: Poppler CLI (`pdftotext`, `pdftoppm`) with `pdf-parse` fallback
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

### PDF Processing Pipeline
1. **PDF Upload** - User uploads PDF via the web interface or processes pre-attached files
2. **Text Extraction** - `pdftotext -layout` extracts raw text from PDF, with `pdf-parse` fallback
3. **Format Detection** - Auto-detects PDF format (2016 style vs 2025 style)
4. **Question Parsing** - Regex-based parser extracts questions, options, answers
5. **PDF Snippet Capture** - Each question is cropped from the original PDF and saved in `figureData` so math figures, formulas, and reasoning diagrams remain visible even when text extraction misses them
6. **Database Storage** - All questions saved to PostgreSQL

### Supported PDF Formats
- **Format 2016**: Questions with `Question ID`, `Status`, `Chosen Option` fields
- **Format 2025**: Questions with direct `Q.N` numbering and `A./B./C./D.` options

### Database Schema
- `papers` - Exam papers (exam name, year, shift, total questions)
- `questions` - Individual questions (text, options A-D, correct answer, figure flag, notes)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Key Files

- `lib/db/src/schema/questions.ts` — Database schema (papers + questions tables)
- `artifacts/api-server/src/lib/pdf-parser.ts` — PDF text extraction and question parsing
- `artifacts/api-server/src/routes/papers.ts` — API routes for upload, list, stats
- `artifacts/question-bank/src/` — React frontend (dashboard, upload, papers, questions)
- `lib/api-spec/openapi.yaml` — API contract

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
