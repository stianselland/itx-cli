# Contributing

## Setup

```bash
git clone https://github.com/stianselland/itx-cli.git
cd itx-cli
npm install
npm run build
```

For development without building:

```bash
npm run dev -- <command>
```

## Project Structure

```
src/
  index.ts              Entry point, command registration
  commands/
    config.ts           login, logout, status, config show
    ticket.ts           ticket list|view|create|update|comment|activities
    user.ts             user list
    alias.ts            alias set|list|remove
  lib/
    client.ts           API client (auth, endpoint discovery, requests)
    config.ts           Persistent config storage (conf)
    output.ts           Table/JSON output helpers
  __tests__/
    commands.test.ts    Command integration tests
    client.test.ts      API client tests
    config.test.ts      Config storage tests
    output.test.ts      Output helper tests
```

## Adding New Resources

1. Create a new command file in `src/commands/`
2. Export a `registerXxxCommands(program: Command)` function
3. Import and call it in `src/index.ts`
4. Add tests in `src/__tests__/`
5. Update descriptions with example usage for LLM discoverability

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests use an isolated config directory (via `ITX_CONFIG_DIR`) so they never touch your real credentials.

## Building

```bash
npm run build         # Compile TypeScript to dist/
```
