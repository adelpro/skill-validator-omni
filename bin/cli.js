#!/usr/bin/env node
// skill-validator-cli — validate agent skills against multiple standards.
// Usage:
//   skill-validator-cli <dir>                       human-readable report (exit 0 = pass)
//   skill-validator-cli <dir> --json                machine-readable report for CI
//   skill-validator-cli <dir> --standard hermes     run only one standard (repeatable)
//   skill-validator-cli <dir> --all                 run every standard (the default)
//   skill-validator-cli --list-standards
//   skill-validator-cli --version
//   skill-validator-cli --help
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, groupChecksByStandard, filterChecksByStandard, resolveStandardLabel, STANDARD_IDS } from '../src/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const json = args.includes('--json');
const help = args.includes('--help') || args.includes('-h');
const version = args.includes('--version') || args.includes('-v');
const listStandards = args.includes('--list-standards');
let all = args.includes('--all') || args.includes('-a');
const standards = [];
let dir = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--standard' || a === '-s') {
    const next = args[i + 1];
    if (!next || next.startsWith('-')) {
      console.error('error: --standard requires a name (see --list-standards)');
      process.exit(2);
    }
    standards.push(next);
    i += 1;
  } else if (a.startsWith('--standard=')) {
    standards.push(a.slice('--standard='.length));
  } else if (!a.startsWith('-')) {
    dir = a;
  }
}

if (listStandards) {
  console.log(`skill-validator-cli ${pkg.version} — available standards:\n`);
  for (const id of STANDARD_IDS) {
    console.log(`  ${id.padEnd(12)} ${resolveStandardLabel(id)}`);
  }
  console.log('\nUse: skill-validator-cli <dir> --standard <name> (repeatable, e.g. -s hermes -s claude)');
  process.exit(0);
}

if (help) {
  console.log(`skill-validator-cli ${pkg.version}
Validate agent skills against multiple standards:
  agentskills.io spec, Anthropic best practices, Hermes in-repo,
  OpenAgent skills.sh discoverability, Claude Code marketplaces,
  Agent Plugins 1.0.0, OpenAI Codex.

Usage:
  skill-validator-cli <dir>                  human report (exit 0 = all pass)
  skill-validator-cli <dir> --json           JSON report for CI
  skill-validator-cli <dir> --standard X     run only standard X (repeatable)
  skill-validator-cli <dir> --all            run every standard (default)
  skill-validator-cli --list-standards
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
  console.error('usage: skill-validator-cli <dir> [--json] [--standard <name>|--all]');
  process.exit(2);
}

let checks;
try {
  checks = await validate(dir);
} catch (e) {
  console.error(`error: cannot validate ${dir}: ${e.message}`);
  process.exit(2);
}

// Standard selection: --all / no flag = everything; --standard filters.
// General (structural) checks always run regardless.
let requested = 'all';
if (!all && standards.length > 0) {
  const filtered = filterChecksByStandard(checks, standards);
  if (!filtered.ok) {
    console.error(`error: unknown standard(s): ${filtered.unknown.join(', ')}`);
    console.error('valid names: ' + STANDARD_IDS.join(', ') + ' (see --list-standards)');
    process.exit(2);
  }
  checks = filtered.checks;
  requested = standards;
}

const failed = checks.filter((c) => !c.ok);
const groups = groupChecksByStandard(checks);

if (json) {
  const out = {
    tool: 'skill-validator-cli',
    version: pkg.version,
    target: dir,
    requested,
    passed: checks.length - failed.length,
    failed: failed.length,
    total: checks.length,
    ok: failed.length === 0,
    standards: groups,
    checks,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  console.log(`Validating: ${dir}`);
  if (requested !== 'all') console.log(`Standards: ${requested.join(', ')} (General always runs)`);
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log('Per standard:');
  for (const g of groups) {
    const mark = g.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${g.name}: ${g.passed}/${g.total}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
