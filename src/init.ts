// `melodic init` — write the skeleton config files a user needs to start.
//
// Writes ~/.melodic/config.yml and ~/.melodic/melodic.service (a systemd
// unit template) plus an empty ~/.melodic/agents/ directory. Existing
// files are NOT overwritten — re-running init on a configured host is a
// no-op for already-present files.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface InitResult {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

const CONFIG_YAML_SKELETON = `# Melodic daemon config — see https://github.com/ibis-coordination/melodic-agent
listen: 127.0.0.1:8080
log_dir: ~/.melodic/logs

# Optional. Built-in resolvers (file://, env://) are always present.
# Add a line per scheme you want to use. The "{name}" / "{path}" / "{ref}"
# token is substituted with the reference body at wake time.
#
# secret_resolvers:
#   op:    "op read {ref}"
#   awssm: "aws secretsmanager get-secret-value --secret-id {ref} --query SecretString --output text"
`;

const SYSTEMD_UNIT_SKELETON = `[Unit]
Description=Melodic — self-hosted Harmonic agent daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/melodic
Restart=on-failure
RestartSec=5
# Run as the user whose home contains ~/.melodic — set this before enabling.
# User=melodic
# Group=melodic

[Install]
WantedBy=multi-user.target
`;

export async function initConfig(configDir: string): Promise<InitResult> {
  await fs.mkdir(path.join(configDir, "agents"), { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];

  await writeIfMissing(path.join(configDir, "config.yml"), CONFIG_YAML_SKELETON, written, skipped);
  await writeIfMissing(path.join(configDir, "melodic.service"), SYSTEMD_UNIT_SKELETON, written, skipped);

  return { written, skipped };
}

async function writeIfMissing(
  filePath: string,
  contents: string,
  written: string[],
  skipped: string[],
): Promise<void> {
  try {
    // 'wx' = write, fail if exists. Atomic check-and-write.
    await fs.writeFile(filePath, contents, { flag: "wx" });
    written.push(filePath);
  } catch (e) {
    if (isNodeError(e) && e.code === "EEXIST") {
      skipped.push(filePath);
      return;
    }
    throw e;
  }
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}
