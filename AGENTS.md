# AGENTS.md — itx-cli

This file teaches AI agents (Claude Code, Copilot, Codex) how to use this CLI
effectively. Format follows the [agents.md](https://agents.md/) convention.

## What this CLI does

`itx` is a read-mostly CLI for the ITX UC platform (a unified communications /
contact-center system used for customer support and CRM). It exposes:

- `itx ticket …` — read/write tickets (the only writes are `ticket create`,
  `ticket update`, `ticket comment`)
- `itx customer …` — read-only: search, view, tickets, activities, summary
- `itx prospect …` — same verbs as customer, scoped to prospect extension type
- `itx user list`, `itx alias …`, `itx config …`, `itx login/logout/status`
- `itx schema [command]`, `itx help schemas` — introspection for agents

## JSON envelope (every `--json` output)

```json
{
  "ok": true,
  "data": <command-specific>,
  "pagination": { "limit": 50, "offset": 0, "total": 12, "hasMore": false }
}
```

On error:

```json
{
  "ok": false,
  "error": { "code": "USAGE | API | NOT_FOUND | AMBIGUOUS | AUTH", "message": "...", "hint": "optional" }
}
```

Output is pretty-printed when stdout is a TTY, compact when piped.

## Exit codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | OK | Success |
| 1 | USAGE | Bad input (missing arg, conflicting flags) |
| 2 | API | Network/5xx/schema mismatch from ITX |
| 3 | NOT_FOUND | Resource does not exist |
| 4 | AMBIGUOUS | Multiple matches when one was expected |
| 5 | AUTH | Not authenticated — run `itx login` |

## Identifier conventions

ITX has three id types you will see:

- `seqNo` — the **UI-visible "customer number"** (e.g., 13918). Default
  positional arg.
- `emenId` — internal entity id (large numbers like 6846831).
- `eeexId` — internal extension id.

Customer/prospect commands accept exactly one of:

```
itx customer view 10058                    # default: seqNo
itx customer view --emen-id 6846831        # internal entity id
itx customer view --eeex-id 6846705        # internal extension id
itx customer view --hubspot-id 56610569434 # external system id
itx customer view --org-no 03125247        # org number / SSN
```

Pass exactly one identifier — multiple flags will return USAGE.

## Discovering output shape

```
itx schema customer summary    # returns the JSON contract for that command
itx help schemas               # returns all schemas at once (paste into CLAUDE.md)
```

Use these instead of trial-and-error parsing.

## Common LLM workflows

**"Is customer X happy or in trouble?"**

```bash
itx customer summary <seqNo> --json
```

The response includes `health.signal` (`ok | attention | trouble`) and a
`health.reasons` list. For richer context, escalate depth:

```bash
itx customer summary <seqNo> --depth full --json
```

**"What tickets does this customer have?"**

```bash
itx customer tickets <seqNo> --status open --json
```

**"Show recent emails / calls / sales activity"**

```bash
itx customer activities <seqNo> --type email --since 2026-01-01 --json
itx customer activities <seqNo> --type sale --json
```

Add `--include-bodies` to fetch email body text (slower).
Add `--include-contacts` to aggregate across linked contact persons.

**"Find a customer by name"**

```bash
itx customer search "Wright" --json
itx customer search "Wright Electrical Ltd" --exact --json
```

## Read-only guarantee for new surface

`customer …` and `prospect …` commands never write. The only writes in the CLI
are:

- `itx ticket create <subject>`
- `itx ticket update <id> [...]`
- `itx ticket comment <id> <message>`

If you need an LLM to never make changes, use `customer` / `prospect` /
`schema` commands and skip the three above.

## Performance and cost notes

- `customer summary`, `customer tickets`, `customer activities` are **single
  API calls** to `/itxems/activities?emenId=X` plus reference-data lookups
  (cached per process). Inexpensive for typical use.
- `--include-contacts` adds one parallel call per linked contact emenId.
  Concurrency capped at 5.
- `--include-bodies` adds one parallel email-content fetch per email.
  Concurrency capped at 5.
- Reference data (statuses/priorities/categories) is fetched once per process.

## Development

```bash
npm install
npm run build      # tsc → dist/
npm test           # vitest
npm run dev -- <args>    # tsx (no build step)
```

Tests live in `src/__tests__/`. Vitest is configured to ignore `dist/`.

## Project structure

```
src/
  index.ts               # commander entry, registers all command groups
  commands/
    config.ts            # login, logout, status, config show
    ticket.ts            # ticket list/view/create/update/activities/comment
    user.ts              # user list
    alias.ts             # alias set/list/remove
    customer.ts          # customer search/view/tickets/activities/summary
                         # also exports buildEntityGroup() reused by prospect.ts
    prospect.ts          # prospect mirror (extType=9)
    help.ts              # itx schema, itx help schemas
  lib/
    client.ts            # ItxClient — auth, endpoint discovery, request()
    config.ts            # conf-backed user config (creds, aliases)
    output.ts            # printJsonOk/Error, handleError, exit codes, TTY split
    entity.ts            # resolveEntity (id resolution + linked-contact walk)
    activities.ts        # ACTIVITY_TYPES, htmlToText, resolveTicketActivities
    refdata.ts           # cached statuses/priorities/categories
    schemas.ts           # TS types for every JSON output (public contract)
    summarize.ts         # summary aggregator (health, ticket/comm/pipeline stats)
```

## Conventions

- New commands always emit the `{ok, data}` envelope on `--json`.
- Errors always use `printJsonError` + `exitWithError` (never `process.exit(1)`
  inline).
- New JSON fields go in `lib/schemas.ts` first.
- Refactor with passing tests; never break the existing ticket-activities flow
  silently.

## Read-only against live API for tests

Live probes used `.env` (gitignored). Do not check in real credentials.
Test fixtures live alongside the test files in `src/__tests__/`.
