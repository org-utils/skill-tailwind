# skill-tailwind

> An AI **skill** for writing, configuring, migrating, and reviewing modern **Tailwind CSS v4**
> (CSS-first) — framework-agnostic (plain HTML + CSS/SCSS), teaching **two equal** approaches to
> organizing styles: utility-first and BEM + `@apply`.

**English** · Licence: MIT · Tailwind CSS v4

The agent's entry point is `SKILL.md`; the depth lives in `docs/`, `references/`, `resources/`, and
ready-to-use code lives in `examples/` and `templates/`.

## What this is

skill-tailwind is an **implementation layer** for Tailwind v4: how to correctly express a style with
the means of v4, in any stack or none. The skill helps when you:

- are migrating from Tailwind v3 to v4 and stumbling over the new CSS-first config;
- are setting up semantic design tokens and a dark theme on CSS variables;
- are arguing "utilities in markup vs. `@apply` in CSS" and want a reasoned system, not dogma;
- are reviewing Tailwind code and want a checklist plus an understanding of v4's subtle gotchas.

This is an **implementation layer, not a design layer** — the skill correctly "wires up" Tailwind, but
does not choose the visual direction. Token *values* are replaceable placeholders; only token **names**
are stable.

## Installation (for AI agents)

This repository **is** the skill: `SKILL.md` sits at the repo root, alongside the supporting
`docs/`, `references/`, `examples/`, `templates/`, `resources/`, `workflows/`, `scripts/`, `evals/`.
Install it wherever your agent reads skills from.

### Claude Code

Personal (available in all projects):

```bash
git clone https://github.com/rekryt/skill-tailwind.git ~/.claude/skills/skill-tailwind
```

Project-only (run from the project root):

```bash
git clone https://github.com/rekryt/skill-tailwind.git .claude/skills/skill-tailwind
```

The skill ends up at `…/skills/skill-tailwind/SKILL.md` and is **discovered automatically** — it
loads itself when you're working with Tailwind, or can be invoked explicitly via `/skill-tailwind`.
To update: `git -C ~/.claude/skills/skill-tailwind pull`.

### Claude.ai (web) and Claude Desktop

1. Package the skill into a ZIP so that **the folder sits at the archive root**:

   ```bash
   git clone https://github.com/rekryt/skill-tailwind.git
   zip -r skill-tailwind.zip skill-tailwind
   ```

2. In Claude, open **Settings → Capabilities → Skills** (code execution must be enabled),
   choose **Create skill → Upload a skill**, and upload `skill-tailwind.zip`.
3. The skill loads automatically on relevant requests, or can be invoked via `/skill-tailwind`.
   Uploaded skills are private to your account; on Team/Enterprise plans an admin can share them.

### Claude Agent SDK / Messages API

The skill is uploaded to your workspace, then attached to the request's execution container (requires
the Skills and code-execution beta flags). Python example:

```python
from anthropic import Anthropic
from anthropic.lib import files_from_dir

client = Anthropic()  # reads ANTHROPIC_API_KEY

skill = client.beta.skills.create(
    display_title="Tailwind CSS v4",
    files=files_from_dir("./skill-tailwind"),   # folder containing SKILL.md
)

resp = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=2048,
    betas=["skills-2025-10-02", "code-execution-2025-08-25", "files-api-2025-04-14"],
    container={"skills": [{"type": "custom", "skill_id": skill.id, "version": "latest"}]},
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
    messages=[{"role": "user", "content": "Set up Tailwind v4 design tokens via @theme and a dark theme."}],
)
```

Skills via the API/SDK act **within the workspace** (separately from Claude Code and claude.ai); up to
8 skills per request. See the Agent Skills documentation for exact details — beta identifiers may
change.

### Any other agent / framework

The skill is just `SKILL.md` plus nested references with **progressive disclosure**. Copy this folder
into your agent's skills path (or point the agent at `SKILL.md`): it reads `SKILL.md` first, and pulls
in files from `references/`, `docs/`, `examples/`, `templates/`, etc. as needed. It's the
`description` field in `SKILL.md`'s frontmatter that makes the agent reach for the skill.

## What it covers

- **Tailwind v4 (CSS-first) only:** `@import "tailwindcss"`, config via `@theme`, custom utilities via
  `@utility`, variants via `@custom-variant`/`@variant`. v3 syntax appears only as "before → after."
- **Two equal approaches, paired examples:** **(A) utility-first** (classes in markup) and
  **(B) BEM + `@apply`** in SCSS with declarations grouped by property type — plus *when* to choose which.
- **Design tokens via `@theme`:** semantic names, a dark theme on CSS variables, mapping an external
  design system instead of overriding it.
- **And more:** v3 → v4 migration; build integration (`@tailwindcss/postcss` vs. `@tailwindcss/vite`,
  `@reference` in component styles); responsiveness via `@variant`; states and accessibility; a review
  checklist, decision trees, and an anti-pattern gallery.
- **Grounded in source, not marketing:** behavior is checked against the engine's source and official docs.

## What's out of scope

- **Framework-specific code** (React / Vue / Nuxt / Svelte) — examples are plain HTML + CSS/SCSS;
  JS "glue" (`cn()` / clsx / tailwind-merge) is mentioned only as an optional sidebar.
- **Stateful-JS component behavior** — combobox, command palette, date-picker, sortable table,
  carousel, charts, focus-trap, etc. The skill styles the markup; prefer the native element where one
  exists, otherwise it's a JS layer that Tailwind still styles.
- **Visual/design decisions** — the skill doesn't choose a palette, typography, or "direction." A
  ready-made design system is **mapped** into `@theme` (names stable, values replaceable), not invented.

## BEM convention

For Approach B (BEM + `@apply`): multi-word parts use `camelCase` (lowercase-first). Element separator
`-`, modifier separator `_`:

```
cardList                 // block
cardList_compact         // block modifier
cardList-item            // element
cardList-item_active     // element modifier
cardList_size_lg         // key-value modifier
```

One block per component; elements are always counted from the block (no `-a-b` chains). This is the
**default, and it's configurable** — if the project already has another scheme, follow it.

## Repository structure

| Path | Purpose |
| --- | --- |
| `SKILL.md` | entry point: when to apply, the core approach, and routing to the rest of the sections |
| `README.md` | this human-readable overview |
| `docs/` | conceptual explanations by topic (in depth), including v4.1 features (`text-shadow-*`/`mask-*`, …) |
| `references/` | dense reference material for progressive disclosure, loaded as needed |
| `examples/` | 30 components, each in two variants (A — utility-first, B — BEM + `@apply`) |
| `templates/` | starting points: entry CSS, `@theme` tokens, component skeletons |
| `resources/` | flat, scannable cheat sheets + aggregators (decision trees, anti-patterns, a master checklist) |
| `workflows/` | step-by-step playbooks: v3 → v4 migration, refactoring to tokens, review, choosing A/B, troubleshooting |
| `scripts/` | optional offline checks (no network): v3 anti-patterns, dynamic class names, BEM naming, `@apply` grouping, token validation, TypeScript codegen, and a `cli.mjs` wrapper |
| `evals/` | behavioral quality checks for the skill itself: cases, fixtures, a runnable static harness, and an accessibility checker |

## Quick start

Wiring up v4 is one line instead of three v3 directives, and config lives right in CSS via `@theme`
(names stay stable; change the values to fit your design system):

```css
@import "tailwindcss";

@theme {
  /* values are placeholders; keep the names stable */
  --color-background: oklch(99% 0 0);
  --color-foreground: oklch(21% 0.01 255);
  --color-primary: oklch(52% 0.12 255);
  --color-primary-foreground: oklch(99% 0 0);
  --radius-md: 0.375rem;
}
```

Declared tokens immediately become utilities — `bg-background`, `text-foreground`,
`bg-primary text-primary-foreground`, `rounded-md`; opacity is a slash modifier (`bg-primary/90`).
A ready-made starting point with semantic tokens and a dark theme lives in `templates/theme.css`. From
there, open `SKILL.md` — it routes you to the right section for your task.

## License

[MIT](LICENSE) © 2026 rekryt.

Repository: <https://github.com/rekryt/skill-tailwind>
