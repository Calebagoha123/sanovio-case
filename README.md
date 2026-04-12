# Sanovio Reorder Agent

V1 of a chat-based procurement workspace for hospital reorder workflows. The app lets a user search a medical catalog, inspect product details, and stage a reorder request behind an explicit confirmation gate.

## What It Does

- Natural-language catalog search
- Structured product details with unit hierarchy
- Reorder request creation with approval gating
- Session-scoped request listing and cancellation
- Server-side quantity normalization and date resolution
- Streaming chat responses with structured UI artifacts

## Core Product Rules

- Search can show multiple plausible matches.
- A reorder request is always for one product at a time.
- Writes are never executed directly from model text.
- Session identity is injected server-side.
- Dates and quantity conversions are resolved deterministically in code.

## Architecture

### Frontend

- Next.js 16 App Router
- React 19
- Custom chat workspace in [`src/app/page.tsx`](/Users/calebagoha/Desktop/sanovio-case/src/app/page.tsx)

### Backend / Agent

- Route handler streaming API in [`src/app/api/chat/route.ts`](/Users/calebagoha/Desktop/sanovio-case/src/app/api/chat/route.ts)
- Anthropic model wiring in [`src/lib/agent/agent.ts`](/Users/calebagoha/Desktop/sanovio-case/src/lib/agent/agent.ts)
- Agent loop in [`src/lib/agent/loop.ts`](/Users/calebagoha/Desktop/sanovio-case/src/lib/agent/loop.ts)
- Approval previews in [`src/lib/agent/pending-write.ts`](/Users/calebagoha/Desktop/sanovio-case/src/lib/agent/pending-write.ts)

### Deterministic Business Logic

- Search / details / request tools in [`src/lib/tools`](/Users/calebagoha/Desktop/sanovio-case/src/lib/tools)
- Date parsing in [`src/lib/dates`](/Users/calebagoha/Desktop/sanovio-case/src/lib/dates)
- Unit conversion in [`src/lib/units`](/Users/calebagoha/Desktop/sanovio-case/src/lib/units)
- Shared UI artifact contract in [`src/lib/chat/ui-contract.ts`](/Users/calebagoha/Desktop/sanovio-case/src/lib/chat/ui-contract.ts)

### Persistence

- Supabase-backed catalog and reorder requests
- Schema in [`supabase/migrations/20260412000000_initial.sql`](/Users/calebagoha/Desktop/sanovio-case/supabase/migrations/20260412000000_initial.sql)
- Sample input data in [`data/sample-challenge-v01.xlsx`](/Users/calebagoha/Desktop/sanovio-case/data/sample-challenge-v01.xlsx)

## Repository Layout

```text
src/
  app/                  Next.js app and API routes
  lib/agent/            model loop, tools, approval gate, logging
  lib/chat/             shared UI payload contracts
  lib/tools/            search/details/request tool implementations
  lib/db/               Supabase access layer
  lib/dates/            date parsing and timezone handling
  lib/units/            quantity normalization and conversions
  lib/ingest/           catalog ingestion
supabase/
  migrations/           schema
design-docs/            design rationale and test plan
```

## Local Commands

```bash
pnpm dev
pnpm build
pnpm exec tsc --noEmit
pnpm test:ci
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

## Test Matrix

- `pnpm test:ci`
  Fast deterministic tests suitable for GitHub Actions on every push.
  Currently covers pure date and unit logic.

- `pnpm test:unit`
  Local DB-backed unit tests. Requires local Supabase.

- `pnpm test:integration`
  Mocked agent-loop integration tests. Also expects local Supabase because tool execution touches ingested catalog data.

- `pnpm test:e2e`
  Real-model conversation tests. Requires local Supabase plus `ANTHROPIC_API_KEY`.

## Environment

Required for local development:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` for real agent runs
- optional `HOSPITAL_TIMEZONE`

See [`.env.local.example`](/Users/calebagoha/Desktop/sanovio-case/.env.local.example).

## CI

The repository is set up for a minimal GitHub Actions CI workflow:

- install dependencies
- run `pnpm exec tsc --noEmit`
- run `pnpm test:ci`
- run `pnpm build`

This keeps every push validated without depending on Docker, Supabase, or live model APIs.

## Design Docs

The detailed rationale is in:

- [`design-docs/README.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/README.md)
- [`design-docs/DESIGN.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/DESIGN.md)
- [`design-docs/SEARCH.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/SEARCH.md)
- [`design-docs/TEST_PLAN.md`](/Users/calebagoha/Desktop/sanovio-case/design-docs/TEST_PLAN.md)

## V1 Scope Boundaries

V1 intentionally does not include:

- ERP integration
- auth / multi-user tenancy
- inventory visibility
- cross-session memory
- basket orders spanning multiple products
- production-grade scaling and benchmarking

Those are the next-step topics for V2 and for the follow-up systems design discussion.
