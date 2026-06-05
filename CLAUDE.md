# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> AGENTS.md is for agents *using* the published CLI as a tool. CLAUDE.md (this file) is for agents *working on* the codebase. CONTRIBUTING.md is the human-facing version of the same.

## Commands

```bash
npm install
npm run build         # tsc → dist/
npm run dev -- <args> # tsx, no build step (e.g. `npm run dev -- customer view 10058`)
npm test              # vitest run
npm run test:watch
npx tsc --noEmit      # type check only
npx vitest run src/__tests__/summarize.test.ts -t "stalled"  # single test by name
```

`npm test` runs vitest with `fileParallelism: false` (config in `vitest.config.ts`) because every test shares one isolated `conf` directory via `ITX_CONFIG_DIR`. The config also excludes `dist/**`; never re-add it.

## Releases — automated, do not publish manually

The pipeline owns publishes:

1. Develop on `develop` with [Conventional Commits](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `perf:`, `refactor:` are release-triggering; `docs:`, `test:`, `ci:`, `style:`, `build:` are not). Add `BREAKING CHANGE` in the commit body for a major bump.
2. Open a PR `develop` → `main`. CI runs on Node 20 and 22.
3. On merge to `main`, `.github/workflows/release.yml` analyzes commits since the last `v*` tag, runs `npm version <bump>`, then `npm publish --provenance --access public`, pushes the tag, and creates a GitHub release.

Do not run `npm publish` from a workstation. Provenance attestation requires the workflow's OIDC token. If you find yourself wanting to publish locally, fix the pipeline instead.

## Architecture

```
src/
  index.ts              Commander entry; one registerXxxCommands() per group
  commands/             Thin command handlers — parse opts, call lib/, format output
  lib/                  All non-CLI logic. Tested directly.
    client.ts           ItxClient (auth, endpoint discovery, request())
    auth.ts             requireAuth() — single source of truth for auth gate
    config.ts           conf-backed user config (creds, aliases)
    output.ts           Envelope helpers, exit codes, TTY-aware formatting
    schemas.ts          PUBLIC CONTRACT — TS types for every --json output
    entity.ts           resolveEntity(): id → ResolvedEntity with warnings
    activities.ts       ACTIVITY_TYPES, projectActivity, resolveTicketActivities
    refdata.ts          Cached statuses/priorities/categories (process-local)
    summarize.ts        computeHealth() and the customer-summary aggregator
```

**Module system:** ESM with `"type": "module"` and `Node16` resolution. Imports of TS files use `.js` suffix (`import { foo } from "./bar.js"`) — TypeScript resolves to `.ts` at compile, ESM loads `.js` at runtime. Don't try to import without the suffix.

**lib vs commands:** Commands are *thin*. They handle argument parsing, output formatting, and exit codes. All business logic lives in `lib/` and is testable without commander. When a command grows more than trivial logic, extract.

## The contract: `lib/schemas.ts`

`schemas.ts` is the source of truth for every `--json` output shape. It is **public** — agents read these types via `itx schema <command>`. Rules:

- New `--json` field → add to `schemas.ts` first, then implement.
- Renaming or removing a field is a **major** version bump, no exceptions.
- `COMMAND_FIELDS` at the bottom of `schemas.ts` lists top-level field names per command. Keep it in sync; `itx schema` reads from it.

## The envelope: `lib/output.ts`

Every `--json` command emits one of two shapes:

```ts
{ ok: true,  data: T,         pagination?: {…}, meta?: { truncated?, warnings? } }
{ ok: false, error: { code, message, hint? } }
```

Use `printJsonOk()` / `printJsonError()` — never `printJson()` (kept only as `@deprecated` for the old API; remove its callers when you find them).

Errors route to exit codes via `handleError()` + `inferErrorCode()`:

| Prefix on Error message | Code | Exit |
|---|---|---|
| `Not authenticated…` / `Not configured…` | `AUTH` | 5 |
| `Ambiguous…` | `AMBIGUOUS` | 4 |
| `Not found…` | `NOT_FOUND` | 3 |
| `API error…` | `API` | 2 |
| (anything else) | `UNKNOWN` | 2 |

Throw with the right prefix and routing happens automatically. `client.ts` already maps 401/403 → `Not authenticated:` so auth failures surface correctly without per-call handling.

## ITX API gotchas (probe-verified, undocumented)

These do not match the public API docs. Don't trust the docs — trust the probes.

- **Pagination uses `limitFrom` (offset, 0-indexed) and `limitTo` (page size, max 1000).** `offset` query param is silently ignored. `limitTo > 1000` returns 400.
- **`extensionSeqNoFilters: [{seqNo: N}]` filters server-side** on `entities/search`, even though the docs say only `names`/`exactNames`/`emenIds`/`entityTypes` work. Used by `entity.ts` seqNo lookup.
- **`/itxems/activities?emenId=X` returns the full activity feed** (cases, emails, calls, notes, sales) for the entity in one call. This is the foundation of `customer summary/tickets/activities`. The earlier "use cases/search and client-filter" strategy is dead.
- **`/itxems/cases` has a top-level `entityExtension` field**, not just `members`. `members` are mostly users, not entities — don't filter by `members[].entityExtension.entity.emenId` (only ~3% are populated).
- **`getMembers:true` belongs in the request body**, not query string, on `cases/search` and `activities/search`.
- **`activityTypes` body field expects objects** `[{eatyId: 15}]`, not bare integers.
- **eatyId 17 = Meeting** (only). The earlier `SMS:17` mapping was a phantom — removed.
- **`getEmailContent` may 404 silently** for old/deleted emails. `client.ts` swallows only 404 (returns `null`); all other failures propagate.
- **`cases/search` status filtering uses `emsStatuses:[{emstId:N}]`** (objects), not the documented `emsStatuses:["string"]` (400s) nor `statuses:[N]`. `statuses:[N]` keys on the coarse `internalStatus` bucket and silently ignores `emstId` values. `excludeEmsStatuses:[{emstId}]` excludes. Probe-verified; see `lib/ticketsearch.ts`.
- **Categories are keyed on `ctnoId`, not `emcaId`.** The `/categories` endpoint and `case.category` both use `ctnoId`; there is no `emcaId` field. Earlier code mapped a non-existent `emcaId`, so customer category stats silently bucketed everything as "Uncategorised" — fixed across `refdata.ts`, `summarize.ts`, `customer.ts`. The `cases/search` `categories:[{ctnoId}]` / `excludeCategories` filters work; `priorities:[{empriId}]` works.
- **`cases/search` verified filters:** `assignedToUserIds:[userId]`, `assignedToSelf:true`, `getUnassignedCasesOnly:true`, `includeFollowedCases:true` (self-scoped — the "Following" tab, not "followed by user X"), `entities:[{emenId}]` / `entityExtensions:[{eeexId}]` (filed customer), `seqNumbers:[N…]`, `description` (text), `fromInc`/`toInc` (creation), `updateFromInc`/`updateToInc`. **`users:[{userId}]` 500s** — there's no "followed by user X" filter.
- **A case's filed entity is only on GET `/cases`, never on POST `/cases/search`.** The top-level `entityExtension.entity.emenId` is the customer the case is filed under; search omits it (even with `getMembers`). So `--customer` resolves seqNo→emenId via `resolveEntity` first, then filters with `entities:[{emenId}]` — you cannot read the entity back off a search result. Don't confuse it with role-20 contact members (those are contact persons, not the filed entity).
- **`ticket list --json` projects to `TicketSummary`** (the same shape as `customer tickets`), not raw cases. The projector (`projectCaseSummary` in `commands/ticket.ts`) reads inline name objects from the search result (`emsStatus.name`/`priority.name`/`category.name`), so it needs no refdata. Ids: status `emstId`, priority `empriId`, category `ctnoId`.

## Patterns

- **Auth:** every command starts with `const client = requireAuth(opts)` from `lib/auth.ts`. It JSON-or-stderr's based on `opts.json` and exits 5 on failure.
- **ID resolution:** customer/prospect commands use `buildLookup(positional, opts, role)` to produce an `EntityLookup`, then `resolveEntity(client, lookup)` to fetch. Default positional is `seqNo` (UI-visible customer number). Flags: `--emen-id`, `--eeex-id`, `--hubspot-id`, `--org-no` — exactly one. Validation runs in `validateSingleLookup()`.
- **Truncation warnings:** `resolveEntity` returns `{ identity, contact, linkedContactEmenIds, raw, warnings }`. Pipe `warnings` into `printJsonOk(data, metaFromWarnings(resolved.warnings))` for honest "this might be incomplete" signals.
- **Refdata cache:** `loadRefdata(client)` memoizes per-process. In tests, call `clearRefdataCache()` in `afterEach`.
- **Concurrency:** `customer.ts` uses a 5-worker `pMap()` for parallel fetches (linked-contact activities, email bodies). If you add another, reuse it.
- **Email thread collapse:** `summarize.ts collapseEmailThreads()` runs only at `--depth standard`. `--depth full` shows individual emails.

## Testing patterns

- Use `vi.stubGlobal("fetch", mockFetch)` and chain `.mockResolvedValueOnce()` per expected request. The order matters; if a test fails because of off-by-one, walk the call sequence.
- `commander` programs use `program.exitOverride()` so `process.exit` throws instead of killing the test runner. Suppress writes with `program.configureOutput({ writeOut: () => {}, writeErr: () => {} })`.
- For envelope assertions, `JSON.parse(spy.mock.calls[0][0] as string)` and check `env.ok`, `env.data`, `env.pagination`, `env.meta`.
- For pure logic, prefer testing the lib function directly (e.g. `computeHealth(ticketStats(), commStats(), saleStats(), now)`) over going through commander.

## Conventions enforced by user CLAUDE.md

The user has global rules in `~/.claude/CLAUDE.md` that this repo also honors:

- No Claude attribution in commit messages (no `Co-Authored-By` lines).
- Don't suggest running the dev server; the user manages that.
- Don't suggest committing or running git commands until asked.
- Use Conventional Commit prefixes (this repo's release pipeline depends on it — see Releases above).
- Don't invent functionality without asking.

## When in doubt

- The probe-verified API behaviour lives in this file and `lib/entity.ts`/`lib/client.ts` JSDoc. The official docs at https://apidoc.itxuc.com are aspirational, not authoritative.
- The CLI is read-only across `customer`/`prospect`. The only writes are `ticket create`, `ticket update`, `ticket comment` — keep it that way unless explicitly extending the write surface.
