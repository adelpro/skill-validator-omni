# skill-validator

One command validates an agent skill or plugin against every standard that gates whether it installs and works across agents. The flagship check is **Agent Plugins 1.0.0** (agent-plugins.org), the vendor-neutral spec for packaging Agent Skills and MCP servers into portable plugins, published by a Technical Steering Committee from Amazon, Cursor, Microsoft, OpenAI, and Vercel.

Other validators cover one spec. `skills-ref` checks only agentskills.io. Creation tools like `skill-creator` produce skills without certifying them. This tool checks the full set:

- **Agent Plugins 1.0.0**: `plugin.json` manifest ($schema, name constraints, closed field set), `skills/` layout, optional `mcp.json`
- **agentskills.io spec**: name/dir rules, description length, compatibility <=500, allowed-tools
- **Anthropic best practices**: third-person descriptions, progressive disclosure, bodies under 500 lines
- **Hermes in-repo standard**: frontmatter fields, section structure, descriptions under 60 chars
- **OpenAgent skills.sh ecosystem**: `npx skills add` discoverable layout, well-known index schema
- **Claude Code**: plugin marketplace layout, plugin manifests, project `.claude/skills/`

Needs only Node >=18. No Python, no PyYAML.

## Install into agents

The repo is packaged for every install path at once. Pick the one for your agent.

**Claude Code**

```bash
/plugin marketplace add adelpro/skill-validator
/plugin install skill-validator@adelpro-skill-validator
```

**Any agent via the skills.sh CLI**

```bash
# preview what's in the repo
npx skills add adelpro/skill-validator -l

# install into specific agents (claude-code, hermes-agent, codex, cursor, ...)
npx skills add adelpro/skill-validator -a claude-code -a hermes-agent --copy -y
```

**Hermes Agent**

```bash
npx skills add adelpro/skill-validator -s skill-validator -a hermes-agent --copy -y
```

**Agent Plugins clients**

The repo root is itself an Agent Plugins package (`plugin.json` with the canonical `$schema`), so compatible clients can load `skills/` and `mcp.json` directly.

**The CLI itself (validation without installing the skill)**

```bash
npx skill-validator-cli <dir>
npm i -g skill-validator-cli   # optional global install
```

## Usage

```bash
# Human report. Exit 0 = all checks pass.
npx skill-validator-cli ./my-skill

# JSON report for CI pipelines.
npx skill-validator-cli ./my-skill --json

# Validate a whole repo. Discovers every skill under skills/ and agent dirs.
npx skill-validator-cli ./my-skills-repo
```

### Per-standard scores

The report ends with a per-standard breakdown. Each standard gets its own pass/fail count, so you see where a skill falls short without reading every check:

```bash
$ npx skill-validator-cli ./my-skill
34/34 checks passed
Per standard:
  [PASS] agentskills.io: 6/6
  [PASS] Anthropic best practices: 3/3
  [PASS] Hermes in-repo: 12/12
  [PASS] OpenAgent skills.sh: 2/2
  [PASS] Claude Code: 4/4
  [PASS] Agent Plugins 1.0.0: 7/7
```

In JSON mode the same breakdown lives in `standards`, one object per standard with `passed`, `failed`, `total`, and `ok`. Gate CI on a single standard:

```bash
npx skill-validator-cli . --json | jq -e '.standards["Agent Plugins 1.0.0"].ok'
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0    | All checks passed |
| 1    | One or more checks failed |
| 2    | Usage error / target unreadable |

### JSON output

```json
{
  "tool": "skill-validator-cli",
  "version": "1.2.0",
  "target": "./my-skill",
  "passed": 27,
  "failed": 0,
  "total": 27,
  "ok": true,
  "standards": [
    { "name": "Agent Plugins 1.0.0", "passed": 7, "failed": 0, "total": 7, "ok": true, "checks": [] }
  ],
  "checks": [{ "name": "spec: name == directory", "ok": true, "detail": "" }]
}
```

## What gets validated

Discovery follows the layouts the ecosystem actually installs from:

- `plugin.json` at the repo root (Agent Plugins package) with the canonical `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
- `SKILL.md` at the repo root (single-skill repo)
- `skills/<name>/SKILL.md`, walked up to 3 levels (`skills/<category>/<skill>/SKILL.md`)
- agent dirs: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.codex/skills/`, `.gemini/skills/`, `.config/opencode/skills/`
- `.well-known/agent-skills/index.json` with `$schema: https://schemas.agentskills.io/discovery/0.2.0/schema.json`
- `.claude-plugin/marketplace.json` + `<plugin>/.claude-plugin/plugin.json` + `<plugin>/skills/`

Every skill found in a repo gets the full check suite. A broken skill nested inside a big repo can't hide. Agent Plugins manifests are checked against the spec's closed field set and name constraints.

## Examples

```bash
# A compliant skill
$ npx skill-validator-cli ./my-skill
27/27 checks passed

# A broken one. Fails fast, tells you why.
$ npx skill-validator-cli ./my-skill
  [FAIL] spec: name == directory  ('My-Skill' vs dir 'my-skill')
  [FAIL] hermes: description <= 60  (73 chars)
1/27 checks passed
```

## CI

```bash
npx skill-validator-cli . --json | jq -e '.ok'
```

## Layout

```
skill-validator/
├── bin/cli.js                  CLI entry
├── src/validate.js             the validator (library + standalone entry)
├── test/                       node --test suite
├── plugin.json                 Agent Plugins 1.0.0 manifest (self-validating)
├── .claude-plugin/             Claude Code marketplace + plugin manifests
└── skills/skill-validator/     the Hermes skill (SKILL.md + scripts + references)
```

## Related

- [agent-plugins.org](https://agent-plugins.org): the flagship standard
- [agentskills.io](https://agentskills.io): the Agent Skills spec
- [`skills-ref`](https://github.com/agentskills/agentskills): validates the agentskills.io spec only
- [`skill-creator`](https://github.com/anthropics/skills): creates skills

## License

MIT
