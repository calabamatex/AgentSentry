# Enablement Model Architecture

## Overview

The enablement engine controls which AgentSentry skills are active. It uses a 5-level progressive system so that teams can adopt capabilities incrementally without being overwhelmed by features they are not ready to use.

Source file: `src/enablement/engine.ts`.

---

## The 5 Levels

Each level is a strict superset of the previous one. Skills are activated in either `basic` or `full` mode; `basic` enables core functionality while `full` unlocks the complete feature set.

| Level | Name | What it activates |
|-------|------|-------------------|
| 1 | Safe Ground | `save_points` (full) |
| 2 | Clear Head | + `context_health` (full) |
| 3 | House Rules | + `standing_orders` (basic) |
| 4 | Right Size | `standing_orders` upgrades to full, + `small_bets` (basic) |
| 5 | Full Guard | `small_bets` upgrades to full, + `proactive_safety` (full) |

At level 1, only save points (checkpointing) are enabled. By level 5, all five skills run at full capacity.

---

## Skill-to-Primitive Mapping

The five skills correspond to the `Skill` enum defined in `src/memory/schema.ts`:

- **save_points**: Git state checkpointing and restore-point management.
- **context_health**: Context window usage estimation and refresh recommendations.
- **standing_orders**: Rule validation against `CLAUDE.md` and `AGENTS.md` policies.
- **small_bets**: Task sizing, complexity analysis, and risk-level estimation.
- **proactive_safety**: Security scanning, vulnerability detection, and safety enforcement.

Each skill maps to one or more MCP tools. For example, `standing_orders` powers the `agent_sentry_check_rules` tool, and `small_bets` powers `agent_sentry_size_task`.

---

## Skill Configuration

Each skill carries a `SkillConfig`:

```typescript
interface SkillConfig {
  enabled: boolean;
  mode: 'off' | 'basic' | 'full';
}
```

The invariants are enforced by `validateEnablementConfig()`:

- If `enabled` is `false`, `mode` must be `'off'`.
- If `enabled` is `true`, `mode` must not be `'off'`.
- `level` must be an integer between 1 and 5.
- All five skill keys must be present.

---

## Default Level Rationale

The default level is **3 (House Rules)**. This activates save points, context health monitoring, and basic standing orders -- the minimum set needed to prevent common operational mistakes (uncommitted work loss, context overflow, rule violations) without requiring teams to understand task sizing or security scanning workflows.

Level 3 is read from the project configuration file under `enablement.level`. If not set or if the config file is missing, level 3 is used as the fallback (see `src/mcp/tools/health.ts`).

---

## Query Helpers

The engine exports several query functions:

- `isSkillEnabled(config, skill)`: Returns whether a specific skill is enabled.
- `getActiveSkills(config)`: Returns the list of currently active skill names.
- `getNextLevel(config)`: Returns what the next level would unlock. At level 5, returns `null`. For skills that change mode (e.g., `standing_orders` going from `basic` to `full`), the unlock description includes the upgrade notation.

---

## Customization Beyond Presets

`generateConfigForLevel()` returns a canonical `EnablementConfig` for a given level. However, the config object is a plain data structure -- callers can mutate the `skills` map directly to create non-standard configurations (e.g., level 2 with `small_bets` enabled in basic mode). The `validateEnablementConfig()` function validates any arbitrary config, not just level-generated ones.

To persist a custom configuration, set the `enablement` key in the project config JSON:

```json
{
  "enablement": {
    "level": 3,
    "skills": {
      "save_points": { "enabled": true, "mode": "full" },
      "context_health": { "enabled": true, "mode": "full" },
      "standing_orders": { "enabled": true, "mode": "basic" },
      "small_bets": { "enabled": true, "mode": "basic" },
      "proactive_safety": { "enabled": false, "mode": "off" }
    }
  }
}
```

The `level` field in a custom config is informational -- actual behavior is determined by the individual skill entries.
