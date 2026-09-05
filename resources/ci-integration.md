# Running the eval scripts in CI

`evals/harness.mjs` and `evals/a11y-check.mjs` are dependency-free Node scripts (see
`evals/README.md`) — no package to install, no service to sign up for. This page is a
minimal, real GitHub Actions workflow that runs both against changed files in a pull
request and fails the check on exit code.

> There is no `@skill-tailwind` npm package, and no PR-comment-posting action. If you want
> either, it's a straightforward follow-up (wrap the JSON output in a small script that
> calls `gh pr comment` or the GitHub API) — not something this skill ships today. What
> follows is only what genuinely exists.

## Minimal workflow: fail the check on FAIL

```yaml
# .github/workflows/tailwind-check.yml
name: tailwind-check

on:
  pull_request:
    paths:
      - '**/*.html'
      - '**/*.css'
      - '**/*.scss'

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      # harness.mjs — v4-not-v3, tokens, dark mode, dynamic classes, BEM/@apply,
      # AI-slop, container queries, framework-agnosticism, core a11y states (axis 7).
      - name: Run harness.mjs
        run: bun evals/harness.mjs .

      # a11y-check.mjs — the complementary a11y slice (motion-reduce, aria-expanded/
      # aria-controls pairing, redundant aria-label, touch-target heuristic).
      - name: Run a11y-check.mjs
        run: bun evals/a11y-check.mjs .
```

Both scripts run fine under `node` too (`node evals/harness.mjs .`) if you'd rather use
`actions/setup-node` — they only use Node built-ins, no Bun-specific APIs.

Either script exits `1` if any non-fixture file has a `FAIL` finding, which fails the job.
Files under `evals/fixtures/` (or marked `FIXTURE — INPUT ONLY`) are recognized and
excluded from the exit code automatically — no path exclusion needed in the workflow.

## Scoping to changed files only

The workflow above scans the whole repo on every PR touching a matching path. On a large
repo you may want to check only files the PR actually changed:

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get changed files
        id: changed
        run: |
          echo "files=$(git diff --name-only origin/${{ github.base_ref }}...HEAD -- '*.html' '*.css' '*.scss' | tr '\n' ' ')" >> "$GITHUB_OUTPUT"

      - name: Run harness.mjs on changed files
        if: steps.changed.outputs.files != ''
        run: bun evals/harness.mjs ${{ steps.changed.outputs.files }}

      - name: Run a11y-check.mjs on changed files
        if: steps.changed.outputs.files != ''
        run: bun evals/a11y-check.mjs ${{ steps.changed.outputs.files }}
```

## Machine-readable output (JSON)

Both scripts accept `--json` and print a structured report to stdout instead of the
human-readable listing — useful if you want to post a summary yourself (a job step, a
custom Slack/GitHub notifier, an artifact upload) rather than relying on the raw exit
code:

```yaml
      - name: Run harness.mjs (JSON)
        run: bun evals/harness.mjs --json . > harness-report.json

      - name: Run a11y-check.mjs (JSON)
        run: bun evals/a11y-check.mjs --json . > a11y-report.json

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: tailwind-eval-reports
          path: |
            harness-report.json
            a11y-report.json
```

Note `--json` mode exits with the same code as the human-readable mode (`1` on any FAIL),
so a step running it with `run:` still fails the job — pipe to a file as shown above if
you want the job to continue to an upload step regardless (combine with `continue-on-error:
true` on the eval step, then gate a later step on `harness-report.json`'s `summary.anyFail`
if you need a hard gate *after* the artifact is captured).

## What this does not do

- **No PR comments.** Posting a summary as a review comment needs a small script (parse
  the JSON, call `gh pr comment "$PR" --body "$SUMMARY"` in a step with `GITHUB_TOKEN`) —
  not included here because it's genuinely project-specific (comment format, whether to
  update-in-place vs post fresh each run, whether to gate on it).
- **No historical tracking.** Whether the score is better or worse than last week is a
  question for whatever you already use for CI trend data (upload the JSON artifacts above
  and diff them, or feed them to your existing dashboard) — the scripts only report the
  current run.
- **No real-build validation.** `harness.mjs`/`a11y-check.mjs` are static (offline)
  checks. To also catch what's only visible from an actual Tailwind build (an unknown
  utility, an invalid `@apply`), add `evals/compile-check.mjs` as a separate step — it
  needs real dependencies installed first (`npm i -D tailwindcss @tailwindcss/cli sass` /
  the Bun equivalent), see `evals/README.md`'s "Real compilation" section.
