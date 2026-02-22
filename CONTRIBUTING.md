# Contributing

Thanks for your interest in contributing to itx-cli. This guide covers everything you need to get started.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork:

```bash
git clone https://github.com/<your-username>/itx-cli.git
cd itx-cli
```

3. Install dependencies and build:

```bash
npm install
npm run build
```

4. Link locally to test your changes:

```bash
npm link
```

For development without building after every change:

```bash
npm run dev -- <command>
```

## Making Changes

1. Create a branch from `main`:

```bash
git checkout -b feat/my-feature
```

2. Make your changes
3. Run tests and type checks:

```bash
npm test
npx tsc --noEmit
```

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/) — this drives automatic versioning:

| Prefix | Meaning | Version bump |
|---|---|---|
| `feat:` | New feature | minor (0.1.0 → 0.2.0) |
| `fix:` | Bug fix | patch (0.1.0 → 0.1.1) |
| `perf:` | Performance improvement | patch |
| `refactor:` | Code restructuring | patch |
| `docs:` | Documentation only | no release |
| `test:` | Tests only | no release |
| `ci:` | CI/CD changes | no release |
| `style:` | Formatting, no logic change | no release |
| `build:` | Build system changes | no release |

For breaking changes, add `BREAKING CHANGE` in the commit body — this triggers a major version bump.

## Submitting a Pull Request

1. Push your branch to your fork:

```bash
git push origin feat/my-feature
```

2. Open a Pull Request against `main` on the upstream repository
3. Fill in a clear description of what you changed and why
4. CI will run tests on Node 20 and 22 — all checks must pass

PRs are reviewed by maintainers. Expect feedback within a few days. Small, focused PRs are easier to review and merge faster.

## Releases

Releases are fully automated. When a PR is merged to `main`, CI will:

1. Analyze commit messages since the last release
2. Determine the version bump (or skip if only docs/test/ci changes)
3. Bump `package.json`, publish to npm, and create a GitHub release

You do **not** need to bump the version manually.

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

## Adding a New Command

1. Create a new file in `src/commands/`
2. Export a `registerXxxCommands(program: Command)` function
3. Import and call it in `src/index.ts`
4. Add tests in `src/__tests__/`
5. Include example usage in `.description()` strings for discoverability (both humans and LLMs read these)

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests use an isolated config directory (via `ITX_CONFIG_DIR`) so they never touch your real credentials.

## Reporting Issues

- Use [GitHub Issues](https://github.com/stianselland/itx-cli/issues) to report bugs or request features
- Include the output of `itx status` (redact your email if you prefer)
- Include the command you ran and the error output
- Check existing issues before opening a new one
