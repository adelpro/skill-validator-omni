import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, parseSimpleYaml, filterChecksByStandard } from '../src/validate.js';

const GOOD_SKILL = `---
name: demo-skill
description: Demonstrates a compliant skill. Use for tests only.
version: 0.1.0
author: Test Author
license: MIT
platforms: [linux, macos, windows]
metadata:
  author: Test Author
  version: 0.1.0
  hermes:
    tags: [demo]
    related_skills: [skill-validator]
---
# Demo Skill

Does demo things.

## When to Use
- Demo

## Procedure
1. Run.

## Pitfalls
- none

## Verification
- ok
`;

async function makeRepo(layout) {
  const root = await mkdtemp(join(tmpdir(), 'sv-test-'));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test('good single skill passes', async () => {
  const root = await makeRepo({ 'demo-skill/SKILL.md': GOOD_SKILL });
  try {
    const checks = await validate(join(root, 'demo-skill'));
    const failed = checks.filter((c) => !c.ok);
    assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bad name fails', async () => {
  const root = await makeRepo({ 'demo-skill/SKILL.md': GOOD_SKILL.replace('name: demo-skill', 'name: Demo--Skill') });
  try {
    const checks = await validate(join(root, 'demo-skill'));
    const failed = checks.filter((c) => !c.ok);
    assert.ok(failed.some((c) => c.name.includes('name format')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('nested repo skill is discovered and validated', async () => {
  const root = await makeRepo({
    'skills/web/demo-skill/SKILL.md': GOOD_SKILL,
  });
  try {
    const checks = await validate(root);
    assert.ok(checks.some((c) => c.name.startsWith('skills/web/demo-skill:') && c.name.includes('name == directory')));
    assert.ok(checks.some((c) => c.name === 'openagent: npx skills discoverable layout' && c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('well-known index schema is checked', async () => {
  const root = await makeRepo({
    'demo-skill/SKILL.md': GOOD_SKILL,
    '.well-known/agent-skills/index.json': JSON.stringify({ skills: [] }),
  });
  try {
    const checks = await validate(root);
    assert.ok(checks.some((c) => c.name.includes('well-known index $schema') && !c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('claude marketplace layout is validated', async () => {
  const root = await makeRepo({
    'skills/demo-skill/SKILL.md': GOOD_SKILL,
    '.claude-plugin/marketplace.json': JSON.stringify({ name: 'demo-market', plugins: [{ name: 'demo', source: './plugins/demo' }] }),
    'plugins/demo/.claude-plugin/plugin.json': JSON.stringify({ name: 'demo' }),
    'plugins/demo/skills/demo-skill/SKILL.md': GOOD_SKILL,
  });
  try {
    const checks = await validate(root);
    assert.ok(checks.some((c) => c.name === 'claude: marketplace.json valid JSON' && c.ok));
    assert.ok(checks.some((c) => c.name === 'claude: plugin demo has skills/' && c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('empty dir reports no skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sv-empty-'));
  try {
    const checks = await validate(root);
    assert.ok(checks.some((c) => c.name === 'skills found' && !c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parseSimpleYaml handles scalars, inline lists, nested maps, block lists', () => {
  const fm = parseSimpleYaml(`name: demo-skill
description: "Has a: colon and stuff."
version: 0.1.0
platforms: [linux, macos, windows]
allowed-tools: Bash(git:*) Read
metadata:
  author: Test Author
  version: "1.0"
  hermes:
    tags:
      - skills
      - validation
    enabled: true
`);
  assert.equal(fm.name, 'demo-skill');
  assert.equal(fm.description, 'Has a: colon and stuff.');
  assert.equal(fm.version, '0.1.0');
  assert.deepEqual(fm.platforms, ['linux', 'macos', 'windows']);
  assert.equal(fm['allowed-tools'], 'Bash(git:*) Read');
  assert.equal(fm.metadata.author, 'Test Author');
  assert.equal(fm.metadata.version, '1.0');
  assert.deepEqual(fm.metadata.hermes.tags, ['skills', 'validation']);
  assert.equal(fm.metadata.hermes.enabled, true);
});

test('agent plugins: valid plugin passes', async () => {
  const root = await makeRepo({
    'plugin.json': JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'acme.tools',
      version: '1.0.0',
      description: 'Demo plugin',
      license: 'MIT',
      keywords: ['tools'],
    }),
    'skills/deploy/SKILL.md': GOOD_SKILL,
  });
  try {
    const checks = await validate(root);
    const failed = checks.filter((c) => c.name.startsWith('agentplugins') && !c.ok);
    assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
    assert.ok(checks.some((c) => c.name === 'agentplugins: $schema declares Agent Plugins' && c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent plugins: bad name and missing $schema fail', async () => {
  const root = await makeRepo({
    'plugin.json': JSON.stringify({ name: 'My--Plugin', customField: 1 }),
  });
  try {
    const checks = await validate(root);
    assert.ok(checks.some((c) => c.name === 'agentplugins: $schema declares Agent Plugins' && !c.ok));
    assert.ok(checks.some((c) => c.name === 'agentplugins: name format' && !c.ok));
    assert.ok(checks.some((c) => c.name === 'agentplugins: no unknown top-level fields (closed schema)' && !c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent plugins: mcp.json invalid fails', async () => {
  const root = await makeRepo({
    'plugin.json': JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'acme.tools',
    }),
    'mcp.json': '{bad json',
  });
  try {
    const checks = await validate(root);
    assert.ok(checks.some((c) => c.name === 'agentplugins: mcp.json valid JSON' && !c.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('groupChecksByStandard buckets checks correctly', async () => {
  const root = await makeRepo({
    'plugin.json': JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'acme.tools',
    }),
    'skills/demo-skill/SKILL.md': GOOD_SKILL,
  });
  try {
    const checks = await validate(root);
    const groups = (await import('../src/validate.js')).groupChecksByStandard(checks);
    const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
    assert.ok(byName['Agent Plugins 1.0.0'], 'agentplugins group exists');
    assert.ok(byName['agentskills.io'], 'agentskills group exists');
    assert.ok(byName['OpenAgent skills.sh'], 'openagent group exists');
    assert.ok(byName['Claude Code'], 'claude group exists');
    assert.equal(byName['Agent Plugins 1.0.0'].total, byName['Agent Plugins 1.0.0'].passed, 'valid plugin: all agentplugins checks pass');
    const total = groups.reduce((n, g) => n + g.total, 0);
    assert.equal(total, checks.length, 'groups cover every check');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every check carries a description', async () => {
  const root = await makeRepo({ 'SKILL.md': GOOD_SKILL });
  try {
    const checks = await validate(root);
    assert.ok(checks.length > 0);
    for (const c of checks) {
      assert.ok(typeof c.description === 'string' && c.description.length > 10, `missing description: ${c.name}`);
    }
    const failed = checks.find((c) => c.name.includes('spec: name == directory'));
    assert.ok(failed.description.includes('directory name'), 'description explains the rule');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filterChecksByStandard keeps only requested standards + General', async () => {
  const root = await makeRepo({ 'SKILL.md': GOOD_SKILL });
  try {
    const checks = await validate(root);
    const r = filterChecksByStandard(checks, ['hermes']);
    assert.ok(r.ok);
    assert.ok(r.checks.every((c) => c.name.includes('hermes') || c.name === 'skills found'), 'only hermes + general');
    assert.ok(r.checks.some((c) => c.name.includes('hermes: ## Procedure')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filterChecksByStandard rejects unknown standards', async () => {
  const root = await makeRepo({ 'SKILL.md': GOOD_SKILL });
  try {
    const checks = await validate(root);
    const r = filterChecksByStandard(checks, ['bogus']);
    assert.equal(r.ok, false);
    assert.deepEqual(r.unknown, ['bogus']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filterChecksByStandard resolves aliases', async () => {
  const root = await makeRepo({ 'SKILL.md': GOOD_SKILL });
  try {
    const checks = await validate(root);
    const r = filterChecksByStandard(checks, ['spec', 'claude-code']);
    assert.ok(r.ok);
    assert.ok(r.checks.every((c) => c.name.includes('spec:') || c.name.includes('claude') || c.name === 'skills found'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
