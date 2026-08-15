# skill-validator

Validate agent skills against **multiple standards in one command** — the
compliance gate for the agent skills ecosystem.

Unlike creation tools (`skill-creator` et al.) and single-spec validators
(`skills-ref`, which checks only the agentskills.io spec), `skill-validator`
checks a skill or repo against the full set of standards that actually gate
whether a skill installs and works across agents:

- **agentskills.io spec** — name/dir rules, description length, compatibility ≤500, allowed-tools
- **Anthropic best practices** — third-person descriptions, progressive disclosure, <500-line bodies
- **Hermes in-repo standard** — frontmatter fields, section structure, ≤60-char descriptions
- **OpenAgent skills.sh ecosystem** — `npx skills add <owner/repo>` discoverable layout, well-known index schema
- **Claude Code** — plugin marketplace layout, plugin manifests, project `.claude/skills/`

## Install

```bash
npx skill-validator-cli <dir>
```

Zero install required (`npx` fetches it). Needs only Node ≥18 — no Python,
no PyYAML. Can also be installed globally: `npm i -g skill-validator-cli`.

## Usage

```bash
# Human report — exit 0 = all checks pass
npx skill-validator-cli ./my-skill

# JSON report for CI pipelines
npx skill-validator-cli ./my-skill --json

# Validate a whole repo (discovers every skill under skills/, agent dirs)
npx skill-validator-cli ./my-skills-repo
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
  "version": "1.0.0",
  "target": "./my-skill",
  "passed": 27,
  "failed": 0,
  "total": 27,
  "ok": true,
  "checks": [{ "name": "spec: name == directory", "ok": true, "detail": "" }]
}
```

## What gets validated

Discovery follows the same layouts the ecosystem actually installs from:

- `SKILL.md` at the repo root (single-skill repo)
- `skills/<name>/SKILL.md`, walked up to 3 levels (`skills/<category>/<skill>/SKILL.md`)
- agent dirs: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.codex/skills/`, `.gemini/skills/`, `.config/opencode/skills/`
- `.well-known/agent-skills/index.json` with `$schema: https://schemas.agentskills.io/discovery/0.2.0/schema.json`
- `.claude-plugin/marketplace.json` + `<plugin>/.claude-plugin/plugin.json` + `<plugin>/skills/`

Every discovered skill gets the full spec + Anthropic + Hermes check suite,
so a broken skill nested inside a big repo can't hide.

## Examples

```bash
# A compliant skill
$ npx skill-validator-cli ./my-skill
27/27 checks passed

# A broken one — fails fast, tells you why
$ npx skill-validator-cli ./my-skill
  [FAIL] spec: name == directory  ('My-Skill' vs dir 'my-skill')
  [FAIL] hermes: description <= 60  (73 chars)
1/27 checks passed
```

## CI

```bash
npx skill-validator-cli . --json | jq -e '.ok'
```

## Related

- [`skills-ref`](https://github.com/agentskills/agentskills) — validates the agentskills.io spec only
- [`skill-creator`](https://github.com/anthropics/skills) — creates skills (single standard)
- `skill-engineer` (Hermes) — multi-agent quality review; pair it with this tool for the subjective half

## License

MIT
