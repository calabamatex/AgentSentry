# Enablement Model Architecture

## Overview

The enablement engine controls which AgentSentry skills are active. It uses a 5-level progressive system so that teams can adopt capabilities incrementally without being overwhelmed by features they are not ready to use.

Source file: `src/enablement/engine.ts`.

---

## The 6 Levels

Each level is a strict superset of the previous one. Skills are activated in either `basic` or `full` mode; `basic` enables core functionality while `full` unlocks the complete feature set.

| Level | Name | What it activates |
|-------|------|-------------------|
| 1 | Safe Ground | `save_points` (full) |
| 2 | Clear Head | + `context_health` (full) |
| 3 | House Rules | + `standing_orders` (basic), + `directive_compliance` (full) |
| 4 | Right Size | `standing_orders` upgrades to full, + `small_bets` (basic) |
| 5 | Full Guard | `small_bets` upgrades to full, + `proactive_safety` (full) |
| 6 | Risk Watch | + `risk_scoring` (full) — context-aware risk scoring **[experimental]** |

At level 1, only save points (checkpointing) are enabled. Level 5 runs the core safety skills at full capacity; Level 6 additionally activates the [experimental] risk-scoring engine (see [risk-scoring.md](./risk-scoring.md)).

---

## Skill-to-Primitive Mapping

The skills correspond to the enablement skill set in `src/enablement/engine.ts` (`ALL_SKILLS`):

- **save_points**: Git state checkpointing and restore-point management.
- **context_health**: Context window usage estimation and refresh recommendations.
- **standing_orders**: Rule validation against `CLAUDE.md` and `AGENTS.md` policies.
- **directive_compliance**: Ensures the agent acts on ACTION/RECOMMEND directives from AgentSentry hooks rather than ignoring them.
- **small_bets**: Task sizing, complexity analysis, and risk-level estimation.
- **proactive_safety**: Security scanning, vulnerability detection, and safety enforcement.
- **risk_scoring** *(Level 6, [experimental])*: Context-aware, confidence-labeled session risk scoring; powers the `agent_sentry_risk_score` tool.

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

The default level is **2 (Clear Head)**. This activates save points and context health monitoring -- the minimum set needed to prevent the two most common operational losses (uncommitted work and context overflow) without imposing rules enforcement, task sizing, or security scanning workflows on teams that have not opted into them. Standing orders and the higher-touch skills are one `enable` step away when a team wants them.

The level is read from the project configuration file under `enablement.level` (the shipped config sets `2`). If not set or if the config file is missing, code paths fall back to the exported `DEFAULT_ENABLEMENT_LEVEL` constant in `src/enablement/engine.ts` -- also `2`. A contract test (`tests/contracts/doc-contracts.test.ts`) pins this document, the shipped config, and the constant to the same value, so this class of drift is caught mechanically.

Note: `agentsentry init` deliberately scaffolds *new* projects at level 1 (Safe Ground) unless `--level` is passed -- a conservative starting point for first-time adoption; its usage text documents this. The *default* described here is what the shipped configuration and fallback paths use.

---

## Query Helpers

The engine exports several query functions:

- `isSkillEnabled(config, skill)`: Returns whether a specific skill is enabled.
- `getActiveSkills(config)`: Returns the list of currently active skill names.
- `getNextLevel(config)`: Returns what the next level would unlock. **By design, it never suggests Level 6** — Risk Watch is [experimental] and strictly opt-in, so the suggestion ceiling is Level 5 (`MAX_AUTO_SUGGEST_LEVEL`); at level 5 or above it returns `null`. Reaching Level 6 requires an explicit `enable --level 6`. For skills that change mode (e.g., `standing_orders` going from `basic` to `full`), the unlock description includes the upgrade notation.

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
