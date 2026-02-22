# itx-cli

A command-line interface for the [ITX Portal API](https://apidoc.itxuc.com/). Manage support tickets, view full communication histories, comment with @mentions, and assign tickets — all without leaving your terminal.

[ITX](https://www.intelecom.no/) is a unified communications and contact center platform used for customer support. If you're a developer handling escalated support tickets (2nd-line), this CLI gives you fast access to the context you need: emails, calls, chats, WhatsApp messages, and internal comments. Every command supports `--json` output, making it a natural fit for AI agents like [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that can read ticket histories, summarize customer issues, and draft responses on your behalf.

## Quick Start

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install -g itx-cli
itx login
```

Or install from source:

```bash
git clone https://github.com/stianselland/itx-cli.git
cd itx-cli
npm install && npm run build
npm link
```

Paste your API key when prompted. You can find it in your **ITX user profile** — it looks like `?tokenv2=...&rcntrl=...&ccntrl=...`.

Verify you're connected:

```bash
itx status
# ✓ Connected
#
#   User:      Alice Smith <alice@company.com>
#   User ID:   12345
#   Endpoint:  https://app26-node1.itxuc.com
#   SSO:       https://app.itxuc.com
#   Aliases:   (none)
#   Config:    ~/Library/Preferences/itx-cli-nodejs/config.json
```

## Tickets

The core workflow. List your queue, drill into a ticket, read the full conversation history, comment, and reassign — in seconds.

```bash
# See your ticket queue
itx ticket list
itx ticket list --limit 10

# View a specific ticket with members and status
itx ticket view 43146

# Read every email, call, chat message, and comment on a ticket
itx ticket activities 43146

# Add a comment
itx ticket comment 43146 'Reproduced locally, working on a fix'

# Comment and @mention someone (by alias or email, see Aliases below)
itx ticket comment 43146 'Can you check the logs?' --mention dave

# Create a new ticket
itx ticket create 'DNS resolution failing for eu-west customers'

# Update status, category, or assignee
itx ticket update 43146 --status resolved
itx ticket update 43146 --assignee alice@company.com
itx ticket update 43146 --category billing
```

Short aliases work everywhere: `itx t ls`, `itx t view 43146`, `itx t act 43146`.

## Activities: Full Communication History

`itx ticket activities <id>` pulls in the complete communication trail for a ticket:

- **Emails** — sender, recipient, subject, and full body text (HTML stripped to readable plain text)
- **Calls** — source/destination numbers, agent and contact names, duration, recording count
- **Chat / WhatsApp / SMS / Facebook / Instagram / WeChat** — contact info and message content
- **Internal comments** — with author and timestamp

This is especially valuable when you're picking up a ticket mid-conversation and need to understand what's already happened. No more clicking through the ITX web UI to piece together the timeline.

### Machine-readable output

Every command supports `--json` for structured output:

```bash
# Get full activity history as JSON
itx ticket activities 43146 --json

# Pipe ticket data to other tools
itx ticket view 43146 --json | jq '.description'
```

This makes `itx` a bridge between ITX and any tool that consumes JSON — scripts, dashboards, or AI models.

## Users and Aliases

```bash
# List all ITX users
itx user list

# Set up aliases for quick @mentions and assignments
itx alias set dave dave@company.com
itx alias set alice alice@company.com

# Now use short names everywhere
itx ticket update 43146 --assignee dave
itx ticket comment 43146 'Assigned to you' --mention dave
```

## Using with Claude Code

`itx-cli` is designed for AI agent integration. Every command has descriptive help text and `--json` output, so Claude Code can discover commands, read ticket data, and take actions in ITX on your behalf.

### Add ITX context to your project

Add this to your project's `CLAUDE.md` to teach Claude Code about the available ITX commands:

```markdown
## ITX Support Tickets

This project uses ITX for support ticket management. The `itx` CLI is available
for reading and managing tickets.

Common commands:
- `itx ticket list --json` — list open tickets
- `itx ticket view <id> --json` — get ticket details (status, priority, members)
- `itx ticket activities <id> --json` — full communication history (emails, calls, chats, comments)
- `itx ticket comment <id> '<message>'` — add a comment to a ticket
- `itx ticket comment <id> '<message>' --mention <alias>` — comment with @mention
- `itx ticket update <id> --status <status>` — update ticket status
- `itx ticket update <id> --assignee <user>` — reassign a ticket
- `itx user list --json` — list all users

All commands support `--json` for structured output. Use `itx --help` for full reference.
```

### Example prompts

With the CLAUDE.md context above, you can ask Claude Code things like:

```
Look up ticket 43146 and summarize the customer's issue and what's been done so far.
```

```
Check the last 10 tickets and tell me which ones are still waiting on a developer response.
```

```
Read ticket 43146, then add a comment saying we've identified the root cause
and are deploying a fix. Mention @dave for visibility.
```

```
Find any tickets assigned to dave that haven't been updated in the last week.
```

Claude Code will use `itx` commands with `--json` to fetch the data, reason about it, and take action — turning ITX into something you can talk to instead of click through.

## Command Reference

```
itx login                          Log in with your ITX API key
itx logout                         Log out and clear stored credentials
itx status                         Show login status and test API connectivity

itx ticket list                    List tickets (aliases: t ls)
itx ticket view <id>               View ticket details
itx ticket create <subject>        Create a new ticket
itx ticket update <id> [options]   Update a ticket
itx ticket comment <id> <message>  Add a comment to a ticket
itx ticket activities <id>         List all activities on a ticket (aliases: t act)

itx user list                      List all users (aliases: u ls)

itx alias set <name> <value>       Create or update an alias
itx alias list                     List all aliases (aliases: a ls)
itx alias remove <name>            Remove an alias (aliases: a rm)

itx config show                    Show stored configuration values
itx config show --reveal           Show full token values (unmasked)
```

## License

ISC
