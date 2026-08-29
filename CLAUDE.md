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

**Every `protectedProcedure`-derived call (so `householdProcedure` and
`adminProcedure` too) is rate-limited by default** — 100 requests/minute per
`clerkUserId`, via `rate-limiter-flexible`'s in-memory store (no Redis; matches
this app's stance elsewhere of not adding shared infra before it's needed —
revisit with a shared store if this ever runs as more than one process, since
separate processes wouldn't share counts). That baseline is generous enough
for normal interactive use but stops a runaway or scripted client from
hammering any endpoint indefinitely. `publicProcedure` (just `health`) is
exempt — no cost, and rate-limiting a liveness check would fight uptime
monitoring, not protect anything.

**`receipts.scan` carries a second, stricter limit on top of the baseline**
(`strictRateLimit`, 20/hour) — unlike nearly everything else in this API,
each call costs real money (an AWS Textract call), so the baseline alone
isn't tight enough to bound a buggy or malicious client's worst-case cost.
`strictRateLimit(name, points, durationSeconds)` builds a named limiter for
exactly this pattern — reach for it again if another procedure ever gets a
comparable per-call cost (a future dining/restaurant-log feature calling some
priced external API, say).

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

**All household-scoped content is shared state, no author checks.** Recipes
and grocery lists both work this way: any member may create, edit, or delete
anything belonging to their household; `createdBy`/`addedById`/`checkedById`
record who acted but never gate it.

Recipes didn't start this way — the original rule was author-or-admin only
(`assertCanModify`, since removed). That made sense as a first instinct but
didn't hold up: recipes are already private to just one household (nothing
leaks to another, `getForHousehold` reports a foreign recipe as NOT_FOUND
same as a missing one), so restricting edits *within* an already-trusted
household wasn't protecting privacy, just adding an ownership norm — and
applying that norm to recipes alone while grocery lists, staples, and
spending were all already fully open to any member was an inconsistency, not
a real safeguard. It also didn't actually protect the scenario that
motivated it (two members whose relationship sours while still sharing a
household): as long as both remain members, they already have full access to
everything else; the real boundary against that is removing someone from the
household (the Clerk Organization) entirely, not per-recipe authorship.
Revisit only if a genuinely different need shows up — e.g. some recipes
wanting to stay editable-by-one-person on purpose — since that would be a new
feature (a lock flag), not a return to the old default.

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

## Server hardening (`index.ts`)

- **`helmet()`** is applied globally — disables the `X-Powered-By: Express`
  header and sets the standard baseline (`X-Content-Type-Options`,
  `X-Frame-Options`, a baseline CSP). This is a JSON API with no HTML to
  render, so most of helmet's CSP machinery isn't doing heavy lifting here,
  but it's one line with no downside.
- **`createExpressMiddleware` sets `maxBodySize` to 1MB.** Images never pass
  through this body at all — they go straight to S3 via a presigned PUT (see
  Storage below) — so even the largest legitimate mutation (a recipe with
  many ingredients and steps, as text) stays well under that. Exceeding it
  throws `PAYLOAD_TOO_LARGE` (413), per `@trpc/server`'s own handling of the
  option.

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
- **Uploads are capped at `MAX_UPLOAD_BYTES` (15MB)**, checked before a
  presigned URL is ever minted — before this, only content type was
  validated, so nothing stopped an oversized file. The client declares
  `contentLength` alongside `contentType` when requesting the URL;
  `createUploadUrl` also signs that `ContentLength` into the presigned
  request, so S3 itself checks the actual upload's size against it, not just
  the declared one — not yet verified against a real bucket, so the
  server-side check ahead of it is the layer that's certain to hold either
  way.

An upload that is never attached leaves an orphan object; the server never
learns the PUT happened, so a bucket lifecycle rule on `recipes/` is the
intended cleanup.

**Found and fixed while auditing the recipe-authorship change above:**
`recipes.images` (the read path that lists a recipe's photos with render-ready
URLs) had no household check at all — any signed-in user with any household
could pass another household's recipe id and get back presigned read URLs for
its private photos. Every write path already re-validated this correctly
(`assertCanEditRecipe`, since renamed `assertRecipeInHousehold`); the read
path was just never wired to the same check. Fixed by having
`recipe-images.service.ts`'s `listWithUrls` take the actor and run the same
household check every other function there already did.

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

**Use `db:migrate`, never `prisma db push`.** `db:push` schema-syncs without
writing a migration file, which silently drifts the database from the
`migrations/` history the moment it's used — it was deliberately removed from
`package.json` rather than just left as a documented footgun.

**Service-layer tests use `vitest-mock-extended`'s `mockDeep<PrismaClient>()`**,
not a real database — services already take `prisma` as a parameter rather
than importing the singleton, which is exactly what makes this possible. Kept
narrow on purpose: these tests exist to lock in *authorization* behavior
(household isolation, and now — since removing recipes' author-only rule —
"any household member, not just the author"), not to re-verify Prisma's own
query semantics. Coverage today: `recipes.service`, `recipe-images.service`
(the module `recipes.images`'s missing household check was found in),
`grocery-lists.service`, `receipts.service`, `stores.service`. A test mocking
an I/O boundary the service calls (S3 via `lib/storage.js`, in the receipts
and recipe-images suites) uses `vi.mock` with `importOriginal` so the pure,
already-tested parts of that module (key building, content-type/size
validation) stay real rather than being re-mocked. Keep new services
parameterised the same way so this keeps working, and add a test alongside
any new service function that checks a row's household before acting on it —
that check having no test is exactly how the `recipes.images` gap went
unnoticed.
