import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../src/validate.js';

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
