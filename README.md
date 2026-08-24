# Cookhouse API

Express + tRPC backend for Cookhouse — recipes, grocery lists, and (soon)
receipt scanning for spending tracking. Standalone rather than built into the
Next.js app, so a future mobile client can hit the same API.

## Stack

Node/TypeScript, Express, tRPC, Prisma 7 on Postgres (Supabase), Clerk for
auth, S3 for image storage.

## Getting started

```bash
cp .env.example .env   # fill in DB, Clerk, and storage credentials
pnpm install            # runs `prisma generate` automatically
pnpm db:migrate
pnpm db:seed             # required — measurement units and tags
pnpm dev
```

Runs on port 4000 by default. Needs Node 22.12+ (see `.nvmrc`) — Prisma 7
won't install on anything older.

## Useful commands

```bash
pnpm dev              # start the dev server
pnpm test              # run tests
pnpm typecheck
pnpm db:seed:demo      # sample recipes/lists, for testing the frontend
pnpm build:contract    # rebuild the published API type (see CLAUDE.md)
```

## More detail

`CLAUDE.md` covers the architecture, conventions, and the reasoning behind
anything that isn't obvious from the code.
