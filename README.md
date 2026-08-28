# Cookhouse API

The backend for **Cookhouse**, a household food & grocery app: shared
recipes, a collaborative grocery list, staple reminders, receipt-scan
spending tracking, and spending reports — all scoped to a household, not a
single user.

This is the only service that talks to Postgres. The web client is
[`cookhouse-webplatform`](https://github.com/Benson-D/cookhouse-webplatform),
which owns no data of its own and reaches everything here over tRPC.
Standalone rather than built into that Next.js app, so a future mobile
client can hit the same API without a later extraction.

## Status

Backend and frontend are both built for recipes, grocery lists, staple
management, image upload, receipt scanning, and spending reports. Recipe URL
import is the only feature with a backend and no frontend consumer yet.

## Tech stack

- **Express + tRPC** — the less common pattern for a tRPC backend, chosen so
  the API stays reusable by a future mobile client
- **Prisma 7** on **Postgres** (Supabase) — foreign keys are emulated
  client-side (`relationMode = "prisma"`), not enforced by the database
- **Clerk** for auth, configured as a B2B app — households map to Clerk
  Organizations, so every household-scoped procedure requires an active one
- **AWS S3** for image storage, presigned and never proxied through this
  server — recipe photos and receipts alike
- **AWS Textract** (`AnalyzeExpense`) for receipt OCR, run synchronously
  inline in a mutation rather than queued
- **Zod** for input validation, with types inferred rather than hand-written
- **Vitest** for pure `lib/*` functions and input schemas

## Architecture

- `src/modules/<domain>/` — one folder per feature, each split into a
  `*.router.ts` (procedure wiring only), `*.input.ts` (zod schemas), and a
  `*.service.ts` (Prisma queries, transactions, domain logic) added once the
  logic earns it.
- `src/lib/` — pure helpers shared across modules: no Prisma, no I/O,
  directly unit-testable.
- `contract/` — publishes just the `AppRouter` type as its own package
  (`@cookhouse/api-contract`), so the frontend keeps end-to-end type
  inference without depending on this repo's source.

See this repo's `CLAUDE.md` for the reasoning behind each of these.

## Getting started

Needs Node matching `.nvmrc` (`nvm use`) — Prisma 7 won't install on
anything older.

```bash
cp .env.example .env   # fill in DB, Clerk, and storage credentials
pnpm install            # runs `prisma generate` automatically
pnpm db:migrate
pnpm db:seed             # required — measurement units and tags
pnpm dev                 # http://localhost:4000
```

The frontend ([`cookhouse-webplatform`](https://github.com/Benson-D/cookhouse-webplatform))
expects this running alongside it.

Other commands:

```bash
pnpm test              # run tests
pnpm typecheck
pnpm db:seed:demo      # sample recipes/lists/purchases, for testing the frontend
pnpm build:contract    # rebuild the published API type
```

## More detail

`CLAUDE.md` covers the architecture, conventions, and the reasoning behind
anything that isn't obvious from the code.
