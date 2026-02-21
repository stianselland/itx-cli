# itx-cli

CLI tool for the [ITX Portal API](https://apidoc.itxuc.com/).

## Install

```bash
npm install
npm run build
```

To make the `itx` command available globally:

```bash
npm link
```

For development without building:

```bash
npm run dev -- <command>
```

## Configuration

Before using the CLI, configure your API credentials:

```bash
itx config set \
  --sso-endpoint https://sso.itxuc.com \
  --tokenv2 YOUR_TOKEN \
  --rcntrl YOUR_RCNTRL \
  --ccntrl YOUR_CCNTRL
```

Verify connectivity:

```bash
itx config test
```

Other config commands:

```bash
itx config show           # Show config (tokens masked)
itx config show --reveal  # Show full token values
itx config clear          # Remove all stored config
```

## Ticket Management

```bash
# List tickets
itx ticket list
itx t ls -l 10              # Short alias, limit to 10

# Get ticket details
itx ticket get 12345

# Create a ticket
itx ticket create -s "Server outage" -d "Production DB unreachable"

# Update a ticket
itx ticket update 12345 -s "New subject" --status resolved
```

All commands support `--json` for machine-readable output.

## Project Structure

```
src/
  index.ts              Entry point
  commands/
    config.ts           itx config set|show|clear|test
    ticket.ts           itx ticket list|get|create|update
  lib/
    client.ts           API client (auth, endpoint discovery)
    config.ts           Persistent config storage
    output.ts           Table/JSON output helpers
```

## Adding New Resources

1. Create a new command file in `src/commands/`
2. Export a `registerXxxCommands(program)` function
3. Import and call it in `src/index.ts`
