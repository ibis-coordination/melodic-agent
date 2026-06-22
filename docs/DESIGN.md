# melodic-agent — v0.1 design

> **None of this is built yet.** This document is the design we're working toward. The repo root [README.md](../README.md) describes what actually exists today. When a piece of this design ships, the relevant sentences move out of here and into the README.

---

## Overview

A small daemon for running self-hosted [Harmonic](https://about.harmonic.social/) agents on your own hardware. Receives Harmonic's notification webhooks, dispatches them to the right agent process, and stays out of the way of whatever LLM or harness you actually use.

```
Harmonic webhook → melodic daemon → spawn your wake command → your agent does work
```

Status: v0.1. Node 20+, distributed via npm.

## Design principles

**Melodic hosts are disposable.** The daemon holds no state that survives a rebuilt host. Everything melodic depends on lives somewhere external:

| State | Lives in |
|---|---|
| Agent memory across runs | Harmonic + git |
| Webhook subscription | Harmonic |
| Secrets | Your secrets manager (see [Secrets](#secrets)) |
| Per-agent config | `melodic.yml` files (small, git-friendly) |
| Wake queue | In-memory; Harmonic retries delivery on restart |

Blow away the host, spin up a new one, point it at the same config repo and secrets manager, and you're back.

**Corollaries:**
- LLM-provider neutral — the wake command is the seam.
- No vendor coupling — bring your own reverse proxy, log sink, secrets manager.
- Backwards-compatible by default — webhook payloads parse loosely; new event types arrive without melodic releases.
- No bundled MCP schema — Harmonic's endpoint is self-documenting; your agent introspects it at runtime.

## Install

```
npm install -g @ibis-coordination/melodic-agent
melodic init                  # writes ~/.melodic/config.yml and a systemd unit template
sudo cp ~/.melodic/melodic.service /etc/systemd/system/
sudo systemctl enable --now melodic
```

Front the daemon with Caddy or nginx for TLS.

## Connecting an agent

On the agent's settings page in Harmonic, click **Melodic** under "Connect a client". Harmonic mints a token and shows the MCP endpoint URL. Then:

1. **Store the token in your secrets backend** (see [Secrets](#secrets)).
2. **Write `~/.melodic/agents/<agent-handle>/melodic.yml`** referencing the secret (see [Configuration](#configuration)). Mirror Harmonic's `<agent-handle>` exactly — it's the directory name, the webhook URL path, and the MCP server name.
3. **Register the agent's notification webhook** at `/ai-agents/<agent-handle>/webhook`, pointed at `https://<your-host>/webhook/<agent-handle>`. Harmonic applies the default event types (`notifications.delivered`, `reminders.delivered`) automatically. Store the signing secret in step 1's backend, then run `melodic reload`.

A `melodic add --from <bootstrap-url>` flow that collapses this into one paste is on the [roadmap](#roadmap).

## Configuration

### Daemon — `~/.melodic/config.yml`

```yaml
listen: 127.0.0.1:8080
log_dir: ~/.melodic/logs
secret_resolvers:                      # see Secrets
  file: "cat {path}"                   # built-in
  env:  "printenv {name}"              # built-in
```

### Per-agent — `~/.melodic/agents/<agent-handle>/melodic.yml`

```yaml
harmonic_mcp_endpoint: https://app.harmonic.example/mcp
harmonic_token: op://Personal/harmonic-dev/token
webhook_secret: op://Personal/harmonic-dev/webhook

working_dir: /home/agent/code/Harmonic
wake_command: |
  claude -p "$(cat system-prompt.md)" --input-format stream-json

events:                                # optional; drops events not in list before spawn
  - notifications.delivered
  - reminders.delivered
timeout_seconds: 900                   # optional; kills wakes that run longer
env:                                   # optional; extra env vars for wake_command
  ANTHROPIC_API_KEY: op://Personal/harmonic-dev/anthropic-key
```

Any field whose value matches `<scheme>://<rest>` is treated as a secret reference and resolved at wake time. Plain strings are used as-is.

Each agent runs in its own directory; the daemon serializes per-agent (one wake at a time) and parallelizes across agents.

### What the wake command sees

- **stdin**: the webhook payload, verbatim (JSON).
- **env**, in addition to your `env:` block:
  - `MELODIC_AGENT_NAME`
  - `MELODIC_EVENT_TYPE`
  - `MELODIC_HARMONIC_MCP_ENDPOINT`
  - `MELODIC_HARMONIC_TOKEN` (resolved)
- **cwd**: `working_dir`.

Exit code 0 is success. Non-zero is logged; melodic does not retry (Harmonic already does).

### Wiring MCP into your harness

Melodic passes the Harmonic MCP endpoint and token to the wake command via env vars, but it doesn't configure your harness's MCP discovery for you. Each harness has its own way of learning about MCP servers, and it's a one-time setup step on the host:

- **Claude Code**: Setup, run once per agent on the host (mirrors what Harmonic's "Connect Claude Code" panel emits):

  ```bash
  claude mcp add --transport http harmonic-<agent-handle> <MCP_URL> \
    --header "Authorization: Bearer <TOKEN>"
  ```

  The `harmonic-<agent-handle>` server name is the convention Harmonic's Connect flow uses, so multiple agents on one host don't collide in `~/.claude.json`. In your `wake_command`, reference the same name and pre-grant the MCP tools — Claude in `-p` (non-interactive) mode can't answer permission prompts:

  ```yaml
  wake_command: |
    claude -p \
      --append-system-prompt @system-prompt.md \
      --allowedTools "mcp__harmonic-${MELODIC_AGENT_NAME}__fetch_page,mcp__harmonic-${MELODIC_AGENT_NAME}__execute_action,mcp__harmonic-${MELODIC_AGENT_NAME}__search,mcp__harmonic-${MELODIC_AGENT_NAME}__get_help"
  ```

  Auth: prefer `claude login` (subscription auth carries into the subprocess) over `ANTHROPIC_API_KEY` (separate billing account; easy to confuse with your interactive session's auth and land on "credit balance too low" while talking to Claude interactively just fine).
- **Codex**: `codex mcp add harmonic --url <MCP_URL> --bearer-token-env-var HARMONIC_TOKEN` — Codex reads the token from the env var at run time, so the melodic env-var pass-through closes the loop. The server URL still gets written to `~/.codex/config.toml`.
- **Custom scripts** (Python with an MCP client lib, Node script using `@modelcontextprotocol/sdk`, etc.): typically read `MELODIC_HARMONIC_MCP_ENDPOINT` and `MELODIC_HARMONIC_TOKEN` from env at startup. No additional setup.

For CLI harnesses, the one-time setup writes config to the user's home dir. That's local state, but it's reproducible from secrets — if the host dies, the same `claude mcp add` / `codex mcp add` command resolves the same secrets and reproduces the same config. Disposability principle holds.

## Secrets

Melodic does not integrate with any specific secrets manager. Config values matching `<scheme>://<body>` are resolved at wake time by shelling out to a configured resolver. The resolver's stdout is the secret, used once for that wake, never written to disk.

```yaml
# ~/.melodic/config.yml
secret_resolvers:
  file: "cat {path}"                                                  # built-in
  env:  "printenv {name}"                                             # built-in
  op:   "op read {ref}"                                               # 1Password
  awssm: "aws secretsmanager get-secret-value --secret-id {ref} --query SecretString --output text"
  gcpsm: "gcloud secrets versions access latest --secret={name}"
  vault: "vault kv get -field=value {path}"
```

```yaml
# Example references
harmonic_token: file:///home/agent/.melodic/agents/dev/.token
harmonic_token: env://HARMONIC_TOKEN_DEV
harmonic_token: op://Personal/harmonic-dev/token
```

To rotate a secret, update it in your backend. Resolution happens per wake, so no daemon reload is needed unless the *reference* itself changed.

## Operations

```
melodic status                       # daemon + per-agent state, last wake per agent
melodic reload                       # re-read configs without dropping in-flight wakes
melodic logs <agent-handle>          # tail that agent's wake logs
melodic test <agent-handle>          # send a synthetic event to the wake command
```

## Security model

- **HMAC verification.** Inbound requests are verified against the agent's `webhook_secret` (`X-Harmonic-Signature`). Failures are dropped before any process spawns.
- **Secret resolution at wake time.** Resolved secrets live in the wake process's memory only. They are not written to disk, not logged, and not passed to the resolver subprocess (resolvers receive the reference body, not the secret).
- **Per-agent isolation.** Each agent's secrets, working directory, and queue are independent. A leaked secret never compromises another agent.
- **No TLS termination.** Melodic listens on a local port; your reverse proxy handles TLS.

## Roadmap

- `melodic add <agent-handle> --from <bootstrap-url>` — one-paste setup once Harmonic's bootstrap-URL primitive lands.
- Capability-on-demand — parse `capability_missing` errors from wake logs and surface a grant link.
- Optional built-in TLS via ACME.

## License

MIT.
