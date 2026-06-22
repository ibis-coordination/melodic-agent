# melodic-agent

A self-hosted daemon for running [Harmonic](https://about.harmonic.social/) agents on your own hardware. The plan: receive Harmonic's notification webhooks, dispatch them to per-agent processes, stay out of the way of your LLM or harness.

## Status

**Pre-alpha. Scaffold only.** No daemon. No config loading. No webhook handling. None of the CLI commands do anything yet. **Don't install this.**

See [docs/DESIGN.md](docs/DESIGN.md) for what v0.1 will look like once it's built.

## What's here today

- TypeScript project layout: `tsconfig.json`, `npm run build`, `npm run typecheck`.
- `src/cli.ts` — CLI stub that prints usage and exits non-zero for every subcommand.
- `src/index.ts` — exports a `VERSION` constant. That's it.

## Development

```
npm install
npm run typecheck
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
