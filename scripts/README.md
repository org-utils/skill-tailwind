# scripts/ — optional checks (Tailwind v4)

Six small helper scripts, plus a `cli.mjs` wrapper. **All are entirely optional**: the
skill works without them too. **No dependencies** — only Node's built-in modules, so they
**work offline** and require no package installation, and run under `node` or `bun`
interchangeably. They run on any OS (Windows/Unix); paths are handled via `node:path`.

These are handy additions for CI or local checks, not part of the mandatory
workflow. See also `evals/harness.mjs` (behavioral review, axes 1–11) and
`evals/a11y-check.mjs` (accessibility statics) in `../evals/`, and
`../resources/ci-integration.md` for a GitHub Actions example wiring these together.

## Scripts

### `lint-dynamic-classes.mjs`

Looks for **dynamically assembled** Tailwind-like class names: interpolation
(`` `bg-${tone}` ``) and concatenation (`"text-" + variant`). Tailwind scans
sources as flat text and does not "execute" code, so a class assembled from
pieces will not make it into the final CSS.

The script is **heuristic** — false positives are possible; verify each spot.

The advice it prints: write **full class names** and select them via a
mapping dictionary, or list the variants in CSS via
`@source inline("bg-{primary,accent}")`.

### `check-v3-antipatterns.mjs`

Scans `.css` / `.scss` / `.html` and the like for **Tailwind v3** syntax that
was removed or renamed in v4, and for each hit shows **what it is** and **what
to replace it with in v4**. Covers:

- `@tailwind base|components|utilities` → `@import "tailwindcss";`
- `bg-opacity-*` / `text-opacity-*` / `border-opacity-*` → slash modifier (`bg-primary/50`)
- `bg-gradient-to-*` → `bg-linear-to-*`
- `bg-[--var]` → `bg-(--var)`
- `@layer utilities { … }` → `@utility name { … }`
- `important: true` → `@import "tailwindcss" important;`
- `darkMode:` → `@custom-variant dark (&:where(.dark, .dark *));`

### `lint-bem.mjs`

Detects violations of the **hard BEM naming rules** that hold regardless of naming
scheme (`references/approaches.md`): a modifier class used without its base class
present, and "elements of elements" (a chained element separator). Supports
`--scheme=react|classic|two-dashes|camelcase` (default `react`, the skill's default
scheme). Heuristic over class-attribute text — it skips anything that matches a
Tailwind-utility-looking pattern so it doesn't misparse `min-w-0` as BEM.

### `lint-apply-grouping.mjs`

Detects `@apply` lines that violate the fixed 7-group order in
`resources/apply-grouping.md` (layout → sizing → spacing → background/borders/shape →
typography → effects/motion → interaction): groups out of order across consecutive
`@apply` lines in the same rule, and a single `@apply` line whose utilities span more
than one group. Suppressed inside state/pseudo-variant nested rules (`&:hover`,
`&::before`, `&[open]`, `@starting-style`) — the grouping discipline is for a rule's
base declaration set, not a state's often-coupled properties.

### `validate-tokens.mjs`

Checks a `@theme` block's dark-mode contrast pairing — every `--color-X` /
`--color-X-foreground` pair must be re-declared in `.dark { ... }` too (the rule
documented in `templates/theme.css`'s own comment and `docs/dark-mode.md` §8) — and flags
arbitrary hardcoded colors (`bg-[#fff]`, `text-[rgb(...)]`) in consumer files instead of
a semantic token. Also prints an INFO-only list of tokens it never saw referenced.

### `generate-token-types.mjs`

TypeScript codegen from a REAL `@theme` block (default `templates/theme.css`, or pass
your project's own theme file) — emits literal-union types for the project's actual
token names plus color-utility-class template-literal types, so a typo in a token name
fails to typecheck. Re-run it whenever `theme.css` changes; nothing here is a guessed or
hardcoded token list.

```sh
node scripts/generate-token-types.mjs path/to/theme.css -o path/to/tokens.d.ts
```

### `cli.mjs`

A single entry point wrapping every script above plus `evals/harness.mjs` and
`evals/a11y-check.mjs`, so the skill's checks can be driven as one command. This is a
**local wrapper living in this repo**, not something published to the npm registry —
see `../package.json`'s `bin` field for how a maintainer could publish it as one.

```sh
node scripts/cli.mjs <check-v3|lint-dynamic|lint-bem|lint-apply|tokens|gen-types|review|a11y|all> [paths...]
```

## How to run

```sh
# current folder
node scripts/lint-dynamic-classes.mjs
node scripts/check-v3-antipatterns.mjs
node scripts/lint-bem.mjs
node scripts/lint-apply-grouping.mjs
node scripts/validate-tokens.mjs

# specific paths
node scripts/lint-dynamic-classes.mjs src ui
node scripts/check-v3-antipatterns.mjs styles/app.css

# everything at once
node scripts/cli.mjs all src
```

Each script prints `file:line`, a snippet/tip, and a final summary. The exit
code is **1** if anything is found (handy for CI), and **0** if clean. The
`node_modules`, `.git`, and build-artifact directories are skipped
automatically.
