#!/usr/bin/env node
// Entry point for the `melodic` CLI. Dispatch logic lives in runCommand so
// it's testable without spawning a subprocess. main() is invoked only when
// this file is run directly (via the `melodic` bin shim).

import { homedir } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import { initConfig } from "./init.js";
import { startDaemon } from "./daemon.js";

export interface CliOpts {
  /** Base config directory. Defaults to ~/.melodic. */
  readonly configDir?: string;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
}

const STUB_COMMANDS: ReadonlySet<string> = new Set(["status", "reload", "logs", "test"]);

/**
 * Run the CLI with the given arguments. Returns the exit code.
 * - `[]` (no args) starts the daemon and runs until SIGINT/SIGTERM.
 * - `["init"]` writes the config skeleton.
 * - `["help"]` / `["--help"]` / `["-h"]` prints usage.
 * - Other known commands print "not yet implemented" and return non-zero.
 */
export async function runCommand(args: readonly string[], opts: CliOpts = {}): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const configDir = opts.configDir ?? path.join(homedir(), ".melodic");
  const command = args[0];

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage(stdout);
    return 0;
  }

  if (command === undefined) {
    return await runDaemon(configDir, stdout, stderr);
  }

  if (command === "init") {
    const result = await initConfig(configDir);
    for (const p of result.written) stdout.write(`wrote     ${p}\n`);
    for (const p of result.skipped) stdout.write(`exists    ${p}\n`);
    stdout.write(`\nConfig directory: ${configDir}\n`);
    return 0;
  }

  if (STUB_COMMANDS.has(command)) {
    stderr.write(`melodic: "${command}" is not implemented yet in v0.1\n`);
    return 2;
  }

  stderr.write(`melodic: unknown command "${command}"\n`);
  printUsage(stderr);
  return 64;
}

async function runDaemon(configDir: string, stdout: Writable, stderr: Writable): Promise<number> {
  let daemon;
  try {
    daemon = await startDaemon({ configDir });
  } catch (e) {
    stderr.write(`melodic: failed to start — ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  stdout.write(`melodic listening on port ${daemon.port}\n`);

  await new Promise<void>((resolve) => {
    const stop = (signal: NodeJS.Signals) => {
      stdout.write(`melodic: ${signal} received, draining\n`);
      resolve();
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    };
    const onTerm = () => stop("SIGTERM");
    const onInt = () => stop("SIGINT");
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
  });

  await daemon.stop();
  stdout.write(`melodic stopped\n`);
  return 0;
}

function printUsage(out: Writable): void {
  out.write(`Usage: melodic [command]

Without a command, starts the daemon (reads ~/.melodic/config.yml and
~/.melodic/agents/*/melodic.yml). Stays running until SIGTERM/SIGINT.

Commands:
  init            Write ~/.melodic/config.yml and a systemd unit template.
  help            Show this help.

Planned (not in v0.1):
  status          Show daemon + per-agent state.
  reload          Re-read configs without dropping in-flight wakes.
  logs <agent>    Tail an agent's wake logs.
  test <agent>    Send a synthetic event to the wake command.
`);
}

// Run as the entry point only when invoked directly (not when imported by
// tests). import.meta.url comparison is the ESM-native way to do this.
const invokedAsEntry = process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedAsEntry) {
  runCommand(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`melodic: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
