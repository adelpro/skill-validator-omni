#!/usr/bin/env node
// skill-validator-cli — validate agent skills against multiple standards.
// Usage:
//   skill-validator-cli <dir>          human-readable report (exit 0 = pass)
//   skill-validator-cli <dir> --json   machine-readable report for CI
//   skill-validator-cli --version
//   skill-validator-cli --help
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const json = args.includes('--json');
const help = args.includes('--help') || args.includes('-h');
const version = args.includes('--version') || args.includes('-v');
const dir = args.find((a) => !a.startsWith('-'));

if (help) {
  console.log(`skill-validator-cli ${pkg.version}
Validate agent skills against multiple standards:
  agentskills.io spec, Anthropic best practices, Hermes in-repo,
  OpenAgent skills.sh discoverability, Claude Code marketplaces.

Usage:
  skill-validator-cli <dir>           human report (exit 0 = all pass)
  skill-validator-cli <dir> --json    JSON report for CI
  skill-validator-cli --version
  skill-validator-cli --help
`);
  process.exit(0);
}
if (version) {
  console.log(pkg.version);
  process.exit(0);
}
if (!dir) {
  console.error('error: missing <dir> argument');
  console.error('usage: skill-validator-cli <dir> [--json]');
  process.exit(2);
}

let checks;
try {
  checks = await validate(dir);
} catch (e) {
  console.error(`error: cannot validate ${dir}: ${e.message}`);
  process.exit(2);
}

const failed = checks.filter((c) => !c.ok);

if (json) {
  const out = {
    tool: 'skill-validator-cli',
    version: pkg.version,
    target: dir,
    passed: checks.length - failed.length,
    failed: failed.length,
    total: checks.length,
    ok: failed.length === 0,
    checks,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  console.log(`Validating: ${dir}`);
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
}

process.exit(failed.length === 0 ? 0 : 1);
