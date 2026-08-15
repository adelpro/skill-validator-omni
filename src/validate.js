// skill-validator — validate agent skills against multiple standards.
// Standards: agentskills.io spec, Anthropic best practices, Hermes in-repo
// standard, OpenAgent skills.sh ecosystem discoverability, Claude Code
// marketplace installability.
//
// Canonical source: https://github.com/adelpro/skill-validator
// (the Hermes skill keeps a synced copy under scripts/validate.js)
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const SCHEMA_URL = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

const AGENT_SKILL_DIRS = [
  '.claude/skills',
  '.agents/skills',
  '.cursor/skills',
  '.codex/skills',
  '.gemini/skills',
  '.config/opencode/skills',
];

export function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { error: 'frontmatter must start at byte 0 with ---' };
  }
  const rest = content.slice(3);
  const m = rest.match(/\n---\s*\n/);
  if (!m) {
    return { error: 'frontmatter not closed with ---' };
  }
  const fmText = content.slice(3, m.index + 3);
  try {
    const fm = parseYaml(fmText);
    return { fm, body: content.slice(m.index + 3) };
  } catch (e) {
    return { error: `invalid YAML: ${e.message}` };
  }
}

async function isFile(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function hasSkillMd(dir) {
  return isFile(join(dir, 'SKILL.md'));
}

async function walkForSkillMds(root, maxDepth, skip = new Set()) {
  const found = [];
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of dirs) {
    if (!entry.isDirectory() || skip.has(entry.name)) continue;
    const child = join(root, entry.name);
    if (await hasSkillMd(child)) {
      found.push(child);
    } else if (maxDepth > 1) {
      found.push(...(await walkForSkillMds(child, maxDepth - 1, skip)));
    }
  }
  return found;
}

export function validateSingleSkill(skillDir, prefix = '') {
  const checks = [];

  async function run() {
    const skillMd = join(skillDir, 'SKILL.md');
    let content;
    try {
      content = await readFile(skillMd, 'utf8');
    } catch {
      return [{ name: `${prefix}SKILL.md present`, ok: false, detail: `missing ${skillMd}` }];
    }
    const { fm, body, error } = parseFrontmatter(content);
    if (error) {
      return [{ name: `${prefix}frontmatter`, ok: false, detail: error }];
    }
    const name = String(fm.name ?? '');
    const desc = String(fm.description ?? '');

    // Agent Skills spec (agentskills.io/specification.md)
    checks.push({ name: `${prefix}spec: name == directory`, ok: name === skillDir.split(/[\\/]/).pop(), detail: `${name} vs dir ${skillDir}` });
    checks.push({
      name: `${prefix}spec: name format`,
      ok: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name),
      detail: "lowercase alnum + hyphens; no leading/trailing/consecutive '-'",
    });
    checks.push({ name: `${prefix}spec: name <= 64 chars`, ok: name.length >= 1 && name.length <= 64, detail: `${name.length} chars` });
    checks.push({ name: `${prefix}spec: description 1-1024`, ok: desc.length >= 1 && desc.length <= 1024, detail: `${desc.length} chars` });
    checks.push({ name: `${prefix}spec: body non-empty`, ok: body.trim().length > 0 });
    if ('compatibility' in fm) {
      checks.push({
        name: `${prefix}spec: compatibility <= 500`,
        ok: String(fm.compatibility).length <= 500,
        detail: `${String(fm.compatibility).length} chars`,
      });
    }
    if ('allowed-tools' in fm) {
      checks.push({
        name: `${prefix}spec: allowed-tools is a string`,
        ok: typeof fm['allowed-tools'] === 'string',
        detail: 'space-separated tool allowlist (experimental)',
      });
    }

    // Anthropic best practices
    checks.push({
      name: `${prefix}anthropic: third person`,
      ok: !/^(I |You |We |This skill helps me )/.test(desc),
      detail: desc.slice(0, 50),
    });
    const lineCount = content.split('\n').length - 1;
    checks.push({ name: `${prefix}anthropic: body < 500 lines`, ok: lineCount < 500, detail: `${lineCount} lines` });
    let hasSubdirs = false;
    try {
      const entries = await readdir(skillDir, { withFileTypes: true });
      hasSubdirs = entries.some((e) => e.isDirectory());
    } catch { /* ignore */ }
    checks.push({
      name: `${prefix}anthropic: progressive disclosure`,
      ok: hasSubdirs || lineCount < 200,
      detail: hasSubdirs
        ? 'supporting dirs present'
        : `${lineCount} lines, no supporting dirs (fine below 200 lines)`,
    });

    // Hermes in-repo standard
    checks.push({ name: `${prefix}hermes: description <= 60`, ok: desc.length <= 60, detail: `${desc.length} chars` });
    checks.push({ name: `${prefix}hermes: description ends with .`, ok: desc.endsWith('.') });
    for (const field of ['version', 'author', 'license', 'platforms']) {
      checks.push({ name: `${prefix}hermes: has ${field}`, ok: field in fm });
    }
    const meta = fm.metadata ?? {};
    const hermes = meta.hermes ?? {};
    checks.push({ name: `${prefix}hermes: metadata.hermes.tags`, ok: Boolean(hermes.tags) });
    checks.push({ name: `${prefix}hermes: metadata.hermes.related_skills`, ok: Boolean(hermes.related_skills) });
    for (const section of ['When to Use', 'Procedure', 'Pitfalls', 'Verification']) {
      checks.push({ name: `${prefix}hermes: ## ${section}`, ok: body.includes(`## ${section}`) });
    }
    return checks;
  }
  return run();
}

export async function validate(root) {
  const checks = [];
  const rootSkill = join(root, 'SKILL.md');

  // Discover skills: root, skills/ (3 levels), agent dirs
  const discovered = [];
  if (await hasSkillMd(root)) discovered.push(root);
  discovered.push(...(await walkForSkillMds(join(root, 'skills'), 3)));
  for (const agentDir of AGENT_SKILL_DIRS) {
    discovered.push(...(await walkForSkillMds(join(root, agentDir), 2)));
  }

  // Validate every discovered skill (root first, no prefix)
  const validated = new Set();
  if (await hasSkillMd(root)) {
    checks.push(...(await validateSingleSkill(root)));
    validated.add(root);
  }
  for (const d of discovered) {
    if (validated.has(d)) continue;
    const rel = relative(root, d);
    checks.push(...(await validateSingleSkill(d, `${rel}: `)));
  }
  if (discovered.length === 0) {
    checks.push({ name: 'skills found', ok: false, detail: `no SKILL.md at ${root} or under skills/, agent dirs` });
  }

  // --- OpenAgent skills.sh ecosystem (`npx skills add <owner/repo>`) ---
  checks.push({
    name: 'openagent: npx skills discoverable layout',
    ok: discovered.length > 0,
    detail: 'SKILL.md at root, or under skills/ (<=3 levels), or agent dirs',
  });
  const badNames = [];
  for (const d of discovered) {
    const content = await readFile(join(d, 'SKILL.md'), 'utf8').catch(() => '');
    const { fm } = parseFrontmatter(content);
    if (fm && String(fm.name ?? '') !== d.split(/[\\/]/).pop()) {
      badNames.push(`${d.split(/[\\/]/).pop()} (frontmatter ${fm.name})`);
    }
  }
  checks.push({
    name: 'openagent: every skill dir name == frontmatter name',
    ok: badNames.length === 0,
    detail: badNames.slice(0, 3).join('; '),
  });

  // Well-known discovery index schema (HTTP-published skills)
  for (const wk of [join(root, '.well-known/agent-skills/index.json'), join(root, '.well-known/skills/index.json')]) {
    const content = await readFile(wk, 'utf8').catch(() => null);
    if (content !== null) {
      try {
        const idx = JSON.parse(content);
        checks.push({
          name: 'openagent: well-known index $schema',
          ok: idx.$schema === SCHEMA_URL,
          detail: idx.$schema ?? '(missing)',
        });
      } catch (e) {
        checks.push({ name: 'openagent: well-known index $schema', ok: false, detail: `invalid JSON: ${e.message}` });
      }
    }
  }

  // --- Claude Code installability ---
  const mp = join(root, '.claude-plugin/marketplace.json');
  const mpContent = await readFile(mp, 'utf8').catch(() => null);
  if (mpContent !== null) {
    try {
      const mdata = JSON.parse(mpContent);
      checks.push({ name: 'claude: marketplace.json valid JSON', ok: true });
      checks.push({ name: 'claude: marketplace has name', ok: Boolean(mdata.name) });
      checks.push({
        name: 'claude: marketplace lists plugins',
        ok: Array.isArray(mdata.plugins) && mdata.plugins.length > 0,
        detail: `${(mdata.plugins ?? []).length} plugins`,
      });
    } catch (e) {
      checks.push({ name: 'claude: marketplace.json valid JSON', ok: false, detail: e.message });
    }
  }

  // Plugin dirs = subdirectories (up to 2 levels deep, marketplace layouts
  // like ./plugins/<name>/) that contain .claude-plugin/plugin.json
  const pluginDirs = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const oneLevel = join(root, entry.name);
      if (await isFile(join(oneLevel, '.claude-plugin/plugin.json'))) {
        pluginDirs.push({ name: entry.name, dir: oneLevel });
        continue;
      }
      let subEntries = [];
      try {
        subEntries = await readdir(oneLevel, { withFileTypes: true });
      } catch { /* skip */ }
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        const twoLevel = join(oneLevel, sub.name);
        if (await isFile(join(twoLevel, '.claude-plugin/plugin.json'))) {
          pluginDirs.push({ name: sub.name, dir: twoLevel });
        }
      }
    }
  } catch { /* root unreadable */ }

  for (const pd of pluginDirs) {
    const pjContent = await readFile(join(pd.dir, '.claude-plugin/plugin.json'), 'utf8').catch(() => null);
    if (pjContent === null) continue;
    try {
      const pdata = JSON.parse(pjContent);
      checks.push({ name: `claude: plugin ${pd.name} has name`, ok: Boolean(pdata.name) });
      const skillsDir = join(pd.dir, 'skills');
      const skillsFound = await walkForSkillMds(skillsDir, 1);
      checks.push({
        name: `claude: plugin ${pd.name} has skills/`,
        ok: skillsFound.length > 0,
        detail: `${skillsFound.length} skills`,
      });
    } catch (e) {
      checks.push({ name: `claude: plugin ${pd.name} plugin.json valid`, ok: false, detail: e.message });
    }
  }

  const claudeProjectSkills = await walkForSkillMds(join(root, '.claude/skills'), 2);
  const claudeLayoutPresent = mpContent !== null || pluginDirs.length > 0 || claudeProjectSkills.length > 0;
  if (claudeLayoutPresent) {
    checks.push({ name: 'claude: installable layout (marketplace or .claude/skills)', ok: true, detail: 'present; validated above' });
  } else {
    checks.push({
      name: 'claude: no broken .claude layout',
      ok: true,
      detail: 'no .claude-plugin/.claude dirs — Claude layout not claimed (ok for local/Hermes skills)',
    });
  }

  return checks;
}
