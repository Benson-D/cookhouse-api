# cookhouse-api — Express + tRPC API

The only service that talks to Postgres. Standalone (not inside Next.js) so a
future mobile client can call the same API — see the root `CLAUDE.md` for why
that shape was chosen, the confirmed stack, and every domain rule the frontend
also depends on.

## Module convention

**Routers stay thin; complexity lives beside them.** A router file should read
as a table of contents — each procedure declares its auth level and input
schema, then delegates in a line or two.

```
cookhouse-api/src/
├── lib/                 shared across modules, no Prisma
│   ├── access.ts        isAdmin, assertCanModify
│   ├── units.ts         conversion + grocery-line merging (pure)
│   ├── storage.ts       S3-API object storage + key building
│   └── clerk.ts         Clerk Backend SDK client
├── modules/<domain>/
│   ├── *.router.ts      procedure wiring only — auth level, input, delegate
│   ├── *.input.ts       zod schemas + inferred types
│   └── *.service.ts     Prisma queries, transactions, domain logic
├── trpc.ts              procedure builders
└── router.ts            merges module routers into AppRouter
```

A `*.service.ts` is added **when the logic earns it**, not by default — `tags`
and `units` are still single-line Prisma calls and deliberately have none. Split
once a procedure grows a transaction, permission branching, or logic worth
testing on its own.

Two layers, kept distinct:

- **`lib/*` is pure** — no Prisma, no tRPC, no I/O. Directly unit-testable.
- **`*.service.ts` orchestrates** — fetches with Prisma, calls the pure
  helpers, writes back.

This is what stops cross-module features tangling the modules. Generating a
grocery list spans recipes, ingredients and units, but belongs in
`groceryLists.service.ts` calling `lib/units.ts` — never in `recipes.service.ts`
reaching sideways. **The module that owns the rows being written owns the
procedure.**

## Procedure types (`trpc.ts`)

| Builder | Requires |
|---|---|
| `publicProcedure` | nothing |
| `protectedProcedure` | a verified Clerk session |
| `householdProcedure` | session **+ an active Clerk Organization** |
| `adminProcedure` | session + local `Role` of `ADMIN`/`DEVELOPER` |

`householdProcedure` throws `FORBIDDEN: Select a household to continue` when the
token carries no active org. Every household-scoped feature depends on this, so a
user with no organization sees nothing work.

**Clerk session tokens come in two claim shapes, and reading only the old one
is a silent failure, not an error.** v1 tokens carry a flat `org_id`; v2 tokens
(`"v": 2`, what this instance issues) drop that and nest it as `o.id` instead.
`context.ts`'s `readOrgId()` handles both. Reading only `org_id` doesn't throw
— it just reads `undefined`, so `householdProcedure` rejects every request
with the FORBIDDEN above, while the frontend's `useAuth().orgId` parses the
same token correctly and lets the query through. That mismatch is what makes
it look like a frontend bug: two readers of one token, silently disagreeing.
`org_role` shifts the same way (`"org:admin"` → `o.rol: "admin"`) — nothing
reads it yet, but anything that starts to must normalise both shapes too.

Authorship rules differ by domain and are deliberate:

- **Recipes** — anyone in the household creates; only the author or an admin
  edits/deletes (`assertCanModify`).
- **Grocery lists** — shared state, **no author checks at all**. Any member may
  add, check off, or remove anything. `addedById`/`checkedById` record who acted
  but never gate it.

## Prisma

Running **Prisma 7**, which moved connection config out of the schema:

- `prisma.config.ts` holds the datasource URL and the seed command.
- `schema.prisma` has **no `url`/`directUrl`** — those are gone in v7.
- `DATABASE_URL` is Supabase's **pooled** connection (6543), used at runtime.
- `DIRECT_URL` is the **direct** connection (5432), used by Migrate and seed.
  Migrations fail against the pooled URL.

`relationMode = "prisma"` means **foreign keys are emulated in the client, not
in Postgres**. Two consequences that have already bitten:

1. Cascades are client-side, so changing an `onDelete` needs
   `prisma generate` — not a migration. `prisma migrate dev` will correctly
   report "already in sync" and that is not an error.
2. Every relation needs `onDelete` stated explicitly where the default would
   block. Applied so far: `RecipeIngredient.recipe`, `RecipeTag.recipe`,
   `RecipeTag.tag`, `UserFavoriteRecipe.recipe`, `RecipeImage.recipe` and
   `GroceryListItem.list` all cascade — those rows are meaningless without
   their parent. `MeasurementUnit`'s self-relation is `Restrict` on both sides
   (deleting a base unit must not delete everything derived from it);
   self-relations *require* an explicit setting or `prisma generate` refuses to
   run at all.

**`@prisma/client`'s types are generated, not shipped** — `pnpm install` alone
doesn't produce them; `prisma generate` does, and nothing here ran it
automatically until a `postinstall` script was added. Before that, a fresh,
truly standalone install (as opposed to reusing an existing `node_modules`
where generation had already happened once) failed typecheck with `Module
"@prisma/client" has no exported member 'PrismaClient'` — confusing, because
the code hadn't changed. If that error ever reappears, run `pnpm db:generate`
before assuming something's broken. Also confirm the Node version: Prisma 7
requires `^22.12` (see `.nvmrc`/`engines`); below that, `pnpm install` fails
outright at the `prisma` package's own preinstall check.

### Seeding

`MeasurementUnit` and `Tag` are reference data — an empty units table silently
breaks recipe entry and all merging. `pnpm db:seed` populates 16 units
(one base per family, others as a `conversionFactor` into it) and 19 tags. It is
idempotent via upsert, safe against a live database.

**`prisma/seed-demo.ts` is a separate, throwaway fixture set** — recipes,
staples and a grocery list for one real Clerk household, sized to actually
exercise a frontend (pagination, tag filters, favorites). Deliberately *not*
wired into `db:seed`, since that command runs automatically after `prisma
migrate reset` against whatever database is configured, and this must never
land in a shared database unasked. Run by hand:

```bash
pnpm db:seed:demo         # wipes its own previous run, then re-seeds
pnpm db:seed:demo:clean   # removes it, leaves Ingredient rows (global, shared) alone
```

Requires `DEMO_CLERK_ORG_ID` and `DEMO_CLERK_USER_ID` in `.env` — household
rows key on `clerkOrgId`, which is not a local FK, so fixtures seeded against
an invented id are invisible to every signed-in user.

## Service-layer invariants

These are enforced in code, not the schema, so writing rows any other way breaks
them:

- **One active `GroceryList` per household** — `getActive` find-or-creates.
  Postgres would need a partial unique index, which Prisma can't declare.
- **One `GroceryListItem` per ingredient per list** — merging is a service
  convention; there is **no unique constraint on `(listId, ingredientId)`**, so
  concurrent writers could still produce duplicates. Worth fixing before
  real-time lands.
- **`users.getOrSync` is the only writer of `User`** — every path needing a
  local `User.id` (favorites, list attribution) must go through it.

## Storage

`lib/storage.ts` is written against the **S3 API**, so the provider is a config
choice — R2, S3, or any S3-compatible bucket. Set `STORAGE_ENDPOINT` for R2,
leave it empty for AWS. See `.env.example`.

Config is read **lazily** so the server boots and serves every non-image route
with storage unconfigured; it throws only when an upload is attempted.

Uploads are presigned and never proxied. Two details that are security-relevant,
not stylistic:

- Permission is checked **before** the presigned URL is minted — the URL is a
  bearer credential for writing that object.
- `attachImage` **re-validates** the key against the household + recipe prefix
  rather than trusting it, so a caller can't attach another household's object.

An upload that is never attached leaves an orphan object; the server never
learns the PUT happened, so a bucket lifecycle rule on `recipes/` is the
intended cleanup.

**No avatar upload here** — Clerk already handles it (see root `CLAUDE.md`).
This storage layer is for content the app actually owns, not identity.

## Contract package (`@cookhouse/api-contract`)

`contract/` publishes just `AppRouter`'s type — no runtime code, no server
dependencies — so `cookhouse-webplatform` (and a future mobile client) keep
tRPC's end-to-end type inference once the two apps are separate repos, without
either depending on the other's source. `pnpm build:contract` runs
`dts-bundle-generator` against `src/router.ts`, writing a single self-contained
`contract/dist/router.d.ts`.

**That file textually contains `import("@prisma/client")` references — e.g.
`ctx.prisma: PrismaClient<...>` on every procedure — and that's fine, not a
bug to chase.** `Context` carries a real `PrismaClient`, and tRPC bakes the
full context type into each procedure's internal definition, which the
bundler faithfully expands. But normal consumption
(`createTRPCReact<AppRouter>()`, `.recipes.list.useQuery(...)`, reading fields
off the result) never forces TypeScript to resolve that branch — verified by
typechecking the exact real usage pattern against the bundled file with
`cookhouse-webplatform`'s actual `node_modules` (no `@prisma/client` present)
and its actual `tsconfig.json`: zero errors. A raw `grep` for
`@prisma/client` in the bundle will still find it; that's expected and not
evidence of a problem on its own.

**Rebuild after any router or procedure shape change** — `build:contract`
isn't wired into anything automatic yet, so a stale bundle means the frontend
confidently typechecks against a contract that no longer matches reality.
Once split into two repos, this needs to run in CI (or a pre-publish hook) on
every change, not just locally by habit.

## Commands

```bash
pnpm dev             # tsx watch
pnpm typecheck       # tsc --noEmit, includes tests
pnpm test            # vitest run
pnpm build           # tsc -p tsconfig.build.json — excludes *.test.ts from dist
pnpm db:generate     # prisma generate — also runs automatically via postinstall
pnpm db:migrate      # prisma migrate dev
pnpm db:seed         # reference data — units, tags (see Seeding above)
pnpm db:seed:demo         # throwaway fixtures for local frontend testing
pnpm db:seed:demo:clean   # remove them
pnpm build:contract  # rebuild contract/dist/router.d.ts — see Contract package above
```

**`db:push` (`prisma db push`) exists but isn't the real workflow** — it
schema-syncs without a migration file, which drifts from the `migrations/`
history the moment someone uses it. Left in `package.json` for now; treat
`db:migrate` as the actual way to change the schema.

Tests currently cover pure `lib/*` functions and zod input schemas only — no
database, no stub. Services already take `prisma` as a parameter rather than
importing the singleton, which is what would make a stubbed-Prisma test
possible; nothing exercises that path yet. Keep new services parameterised the
same way so that stays true.
