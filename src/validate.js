// skill-validator — validate agent skills against multiple standards.
// Standards: agentskills.io spec, Anthropic best practices, Hermes in-repo
// standard, OpenAgent skills.sh ecosystem discoverability, Claude Code
// marketplace installability.
//
// Canonical source: https://github.com/adelpro/skill-validator
// (the Hermes skill keeps a synced copy under scripts/validate.js)
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Prefer the `yaml` package when resolvable; fall back to a built-in parser
// for the SKILL.md frontmatter subset so the script runs with zero setup.
let parseYaml;
try {
  const yamlMod = await import('yaml');
  parseYaml = (s) => yamlMod.parse(s);
} catch {
  parseYaml = parseSimpleYaml;
}

// Minimal YAML parser for SKILL.md frontmatter: scalar keys, inline lists,
// nested maps via indentation, `key:` + `- item` block lists, quoted,
// boolean, and number values. Fallback when the `yaml` package is absent.
export function parseSimpleYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  const unquote = (v) => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  };
  const clean = (raw) => {
    const line = raw.replace(/#.*$/, '').trimEnd();
    return line.trim() && !line.trim().startsWith('#') ? line : null;
  };
  let i = 0;
  while (i < lines.length) {
    const line = clean(lines[i]);
    i += 1;
    if (line === null) continue;
    const indent = line.match(/^ */)[0].length;
    const content = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const { obj } = stack[stack.length - 1];
    const m = content.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (val === '') {
      // Lookahead: block list (`- item`) or nested map?
      const next = clean(lines[i]);
      const nextIndent = next ? next.match(/^ */)[0].length : -1;
      if (next && next.trim().startsWith('- ') && nextIndent > indent) {
        const list = [];
        while (i < lines.length) {
          const item = clean(lines[i]);
          if (!item || item.match(/^ */)[0].length !== nextIndent) break;
          if (!item.trim().startsWith('- ')) break;
          list.push(unquote(item.trim().slice(2)));
          i += 1;
        }
        obj[key] = list;
      } else {
        const nextObj = {};
        obj[key] = nextObj;
        stack.push({ indent, obj: nextObj });
      }
      continue;
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      obj[key] = val.slice(1, -1).split(',').map((s) => unquote(s)).filter((s) => s !== '');
      continue;
    }
    obj[key] = unquote(val);
  }
  return root;
}

export const SCHEMA_URL = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
export const AGENT_PLUGINS_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const AGENT_PLUGINS_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const AGENT_PLUGINS_ALLOWED_FIELDS = new Set([
  '$schema', 'name', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords', 'extensions',
]);

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

  // --- Agent Plugins 1.0.0 (agent-plugins.org, vendor-neutral spec) ---
  // A plugin dir contains plugin.json at its root. Check the repo root and
  // nested plugin dirs (up to 2 levels), like the Claude plugin scan above.
  const apPluginDirs = [];
  const SKIP_AP_DIRS = new Set(['.claude-plugin', '.git', 'node_modules', '.github', 'test', 'bin', 'src']);
  if (await isFile(join(root, 'plugin.json'))) apPluginDirs.push(root);
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || SKIP_AP_DIRS.has(entry.name)) continue;
    if (await isFile(join(root, entry.name, 'plugin.json'))) {
      apPluginDirs.push(join(root, entry.name));
    } else {
      for (const sub of await readdir(join(root, entry.name), { withFileTypes: true }).catch(() => [])) {
        if (sub.isDirectory() && await isFile(join(root, entry.name, sub.name, 'plugin.json'))) {
          apPluginDirs.push(join(root, entry.name, sub.name));
        }
      }
    }
  }

  if (apPluginDirs.length === 0) {
    checks.push({
      name: 'agentplugins: no plugin.json manifest',
      ok: true,
      detail: 'not packaged as an Agent Plugin — spec claims not made (ok for plain skill repos)',
    });
  }

  for (const pd of apPluginDirs) {
    const label = pd === root ? 'agentplugins' : `agentplugins: ${relative(root, pd)}`;
    const pjPath = join(pd, 'plugin.json');
    let pjContent;
    try {
      pjContent = await readFile(pjPath, 'utf8');
    } catch {
      checks.push({ name: `${label}: manifest readable`, ok: false, detail: pjPath });
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(pjContent);
      checks.push({ name: `${label}: manifest valid JSON`, ok: true });
    } catch (e) {
      checks.push({ name: `${label}: manifest valid JSON`, ok: false, detail: e.message });
      continue;
    }
    checks.push({
      name: `${label}: $schema declares Agent Plugins`,
      ok: manifest.$schema === AGENT_PLUGINS_SCHEMA,
      detail: manifest.$schema ?? '(missing)',
    });
    const pname = String(manifest.name ?? '');
    const nameOk = pname.length >= 1 && pname.length <= 64 &&
      /^(?!.*--)(?!.*\.\.)[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(pname);
    checks.push({
      name: `${label}: name format`,
      ok: nameOk,
      detail: "1-64 chars, lowercase alnum/hyphen/dot, no '--', no '..', alnum ends",
    });
    const unknown = Object.keys(manifest).filter((k) => !AGENT_PLUGINS_ALLOWED_FIELDS.has(k));
    checks.push({
      name: `${label}: no unknown top-level fields (closed schema)`,
      ok: unknown.length === 0,
      detail: unknown.slice(0, 3).join(', ') || 'all fields allowed',
    });
    if ('keywords' in manifest) {
      checks.push({ name: `${label}: keywords is array`, ok: Array.isArray(manifest.keywords) });
    }
    if ('author' in manifest && manifest.author !== null) {
      checks.push({ name: `${label}: author is object`, ok: typeof manifest.author === 'object' && !Array.isArray(manifest.author) });
    }
    // skills/ dir: immediate children with SKILL.md (Agent Plugins layout).
    // Missing skills/ is valid (MCP-only plugin); existing-as-file is not.
    const pluginSkills = await walkForSkillMds(join(pd, 'skills'), 1);
    const skillsDirPath = join(pd, 'skills');
    const skillsIsDir = await readdir(skillsDirPath, { withFileTypes: true }).then(() => true).catch(() => false);
    const skillsIsFile = skillsIsDir ? false : await isFile(skillsDirPath);
    checks.push({
      name: `${label}: skills/ layout`,
      ok: !skillsIsFile,
      detail: skillsIsDir
        ? `${pluginSkills.length} skill(s) in skills/ (immediate children)`
        : skillsIsFile
          ? 'skills/ exists but is not a directory (skills component invalid)'
          : 'no skills/ dir (valid — MCP-only plugin)',
    });
    // mcp.json: optional, must parse as JSON object
    const mcpPath = join(pd, 'mcp.json');
    const mcpContent = await readFile(mcpPath, 'utf8').catch(() => null);
    if (mcpContent !== null) {
      try {
        const mcp = JSON.parse(mcpContent);
        checks.push({ name: `${label}: mcp.json valid JSON`, ok: typeof mcp === 'object' && !Array.isArray(mcp) });
      } catch (e) {
        checks.push({ name: `${label}: mcp.json valid JSON`, ok: false, detail: e.message });
      }
    }
  }

  return checks;
}

// Group checks by standard. Check names carry a standard keyword, so the
// mapping is structural, not guessed: agentplugins, openagent, claude,
// hermes, anthropic, spec. Anything else lands in General.
export function groupChecksByStandard(checks) {
  const KEYWORDS = [
    ['agentplugins', 'Agent Plugins 1.0.0'],
    ['openagent', 'OpenAgent skills.sh'],
    ['claude', 'Claude Code'],
    ['hermes', 'Hermes in-repo'],
    ['anthropic', 'Anthropic best practices'],
    ['spec:', 'agentskills.io'],
  ];
  const groups = new Map();
  const labelFor = (name) => {
    for (const [kw, label] of KEYWORDS) {
      if (name.includes(kw)) return label;
    }
    return 'General';
  };
  for (const c of checks) {
    const label = labelFor(c.name);
    if (!groups.has(label)) {
      groups.set(label, { name: label, passed: 0, failed: 0, total: 0, ok: true, checks: [] });
    }
    const g = groups.get(label);
    g.total += 1;
    if (c.ok) g.passed += 1;
    else { g.failed += 1; g.ok = false; }
    g.checks.push(c);
  }
  return [...groups.values()];
}

// CLI entry when run directly: `node validate.js <dir>` (library otherwise)
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node validate.js <dir>');
    process.exit(2);
  }
  const checks = await validate(dir);
  const failed = checks.filter((c) => !c.ok);
  console.log(`Validating: ${dir}`);
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}
