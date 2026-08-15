import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, parseSimpleYaml } from '../src/validate.js';

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
