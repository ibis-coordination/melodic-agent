#!/usr/bin/env node
// Entry point for the `melodic` CLI. Subcommand dispatch lives here; each
// subcommand's implementation will live in its own module under src/commands/.

const command = process.argv[2];

const KNOWN: ReadonlySet<string> = new Set([
  "init",
  "status",
  "reload",
  "logs",
  "test",
]);

if (command === undefined || command === "help" || command === "--help" || command === "-h") {
  printUsage();
  process.exit(command === undefined ? 64 : 0);
}

if (!KNOWN.has(command)) {
  console.error(`melodic: unknown command "${command}"`);
  printUsage();
  process.exit(64);
}

console.error(`melodic: "${command}" not yet implemented in v0.1`);
process.exit(2);

function printUsage(): void {
  process.stdout.write(`Usage: melodic <command>

Commands:
  init            Write ~/.melodic/config.yml and a systemd unit template.
  status          Show daemon + per-agent state.
  reload          Re-read configs without dropping in-flight wakes.
  logs <agent>    Tail an agent's wake logs.
  test <agent>    Send a synthetic event to the wake command.
`);
}
