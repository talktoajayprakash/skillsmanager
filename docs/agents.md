---
title: Supported Agents
nav_order: 7
---

# Supported Agents

Skills Manager installs skills by symlinking from its local cache into each agent's skills directory. Any agent that reads skills from a directory on the filesystem works.

---

## Agent reference

| Agent | CLI name | Skills directory |
|---|---|---|
| Claude Code | `claude` | `~/.claude/skills/` |
| OpenAI Codex | `codex` | `~/.codex/skills/` |
| Cursor | `cursor` | `~/.cursor/skills/` |
| Windsurf | `windsurf` | `~/.codeium/windsurf/skills/` |
| GitHub Copilot | `copilot` | `~/.copilot/skills/` |
| Gemini CLI | `gemini` | `~/.gemini/skills/` |
| OpenClaw | `openclaw` | `~/.openclaw/skills/` |
| Roo Code | `roo` | `~/.roo/skills/` |
| Generic agents | `agents` | `~/.agents/skills/` |

---

## Installing a skill to an agent

```bash
skillsmanager install <skill-name> --agent <agent>

# examples
skillsmanager install code-review --agent claude
skillsmanager install code-review --agent openclaw
skillsmanager install code-review --agent cursor,windsurf   # multiple agents
```

## Installing to all agents

```bash
skillsmanager install        # installs the skillsmanager skill to every detected agent
```

## Installing to a custom path

```bash
skillsmanager install --path /path/to/custom/skills/dir
```

---

## OpenClaw

OpenClaw's skill system uses the same `SKILL.md` format and `~/.openclaw/skills/` directory structure that Skills Manager is built around. OpenClaw skills are first-class citizens — there's no conversion or adapter needed.

If you're an OpenClaw user, Skills Manager gives you:
- A searchable index of all your skills
- Remote storage and sync across machines
- One-command install to OpenClaw and any other agent simultaneously

See [docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills) for OpenClaw's skill documentation.

---

## Adding an agent

Agent paths are defined in `src/types.ts` as `AGENT_PATHS`. To add support for a new agent, add an entry:

```typescript
export const AGENT_PATHS: Record<string, string> = {
  // ...existing entries
  myagent: path.join(os.homedir(), ".myagent", "skills"),
};
```

Open a PR — contributions welcome.
