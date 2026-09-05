#!/usr/bin/env node
// lint-apply-grouping.mjs — OPTIONAL detector of out-of-order/mixed @apply groups (Approach B).
//
// The script is NOT required: the skill-tailwind skill works fully without it.
// No dependencies — only built-in Node modules (node:fs, node:path).
// Works offline, cross-platform (Windows/Unix), runnable via `node` or `bun`.
//
// What it checks, per resources/apply-grouping.md's seven fixed groups (layout/position,
// sizing, spacing, background/borders/shape, typography, effects/motion, other interaction):
//   1. Within one rule block, consecutive @apply lines must appear in NON-DECREASING
//      group order (group 1 before group 2 before ... group 7) — an @apply line whose
//      lowest-numbered utility group is smaller than the previous @apply line's is flagged
//      as out of order.
//   2. A single @apply line whose utilities span more than one group is flagged as
//      "mixed" — the convention is one @apply line per group.
//
// This is a HEURISTIC prefix-based classifier (same spirit as check-v3-antipatterns.mjs /
// lint-dynamic-classes.mjs): it does not run the real Tailwind engine, so an unrecognized
// utility is simply skipped (not misclassified) and a handful of ambiguous prefixes (e.g.
// bare `flex`, which is both a layout display value and a flex-item shorthand) are resolved
// by the SAME rule resources/apply-grouping.md gives for the common misfiling cases. Verify
// each flagged spot — this script narrows the search, it does not replace resources/apply-grouping.md.
//
// Usage:
//   node scripts/lint-apply-grouping.mjs [paths...]   (defaults to the current folder, .scss/.css only)
//   exit 1 if anything is found (handy for CI), otherwise 0.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const TEXT_EXT = new Set(['.scss', '.sass', '.css']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', '.astro', 'coverage', 'vendor', '.cache',
]);

// Group order and prefixes, transcribed from resources/apply-grouping.md's "Seven groups"
// table plus its "place each utility by its CSS property" misfiling notes. Order in this
// array matters ONLY for the misfiling special-cases (checked before the generic groups);
// the GROUPS list below carries the canonical group index.
const GROUPS = [
  {
    n: 1, name: 'Layout / position',
    re: /^(absolute|relative|fixed|sticky|static|inset(-|$)|top-|right-|bottom-|left-|start-|end-|z-|block$|inline-block$|inline$|flex$|inline-flex$|grid$|inline-grid$|hidden$|table|flow-root$|contents$|place-|items-|justify-|content-|gap-)/,
  },
  {
    n: 2, name: 'Sizing',
    re: /^(w-|h-|size-|min-w-|min-h-|max-w-|max-h-|aspect-|shrink|grow|basis-|flex-(1|auto|initial|none)$)/,
  },
  {
    n: 3, name: 'Spacing',
    re: /^(m-|mx-|my-|mt-|mr-|mb-|ml-|ms-|me-|p-|px-|py-|pt-|pr-|pb-|pl-|ps-|pe-|space-x-|space-y-)/,
  },
  {
    n: 4, name: 'Background / borders / shape',
    re: /^(bg-|border|rounded|ring-|shadow-|outline-|divide-)/,
  },
  {
    n: 5, name: 'Typography',
    re: /^(font-|text-|leading-|tracking-|whitespace-|truncate$|uppercase$|lowercase$|capitalize$|italic$|not-italic$|underline$|overline$|line-through$|no-underline$|antialiased$)/,
  },
  {
    n: 6, name: 'Effects / motion',
    re: /^(opacity-|transition|duration-|ease-|delay-|animate-|transform|scale-|rotate-|translate-|skew-|blur-|brightness-|contrast-|grayscale|saturate-|sepia-|invert$|filter$|backdrop-)/,
  },
  {
    n: 7, name: 'Other interaction',
    re: /^(cursor-|select-|pointer-events-|overflow-|list-|resize$|scroll-|touch-|appearance-|will-change-)/,
  },
];

// Misfiling special-cases from resources/apply-grouping.md's lookup table — checked
// before the generic GROUPS scan so these land in the documented group, not the first
// regex that happens to match a shared prefix.
function classifyUtility(token) {
  // Strip variant/state prefixes (hover:, focus-visible:, dark:, md:, etc.) — grouping
  // is about the base utility's CSS property, not the state it's applied under.
  const base = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;

  if (/^(relative|absolute|fixed|sticky)$/.test(base)) return 1; // position, not shape
  if (/^(leading-|tracking-)/.test(base)) return 5;
  if (/^(shrink|shrink-0|grow|grow-0|flex-1|flex-auto|flex-initial|flex-none)$/.test(base)) return 2;
  if (/^list-/.test(base)) return 7; // own line, not merged with cursor-/select-
  if (/^overflow-/.test(base)) return 7;

  for (const g of GROUPS) {
    if (g.re.test(base)) return g.n;
  }
  return null; // unrecognized utility (custom class, BEM element ref, etc.) — skip, don't guess
}

const findings = [];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function hasTextExt(name) {
  const lower = name.toLowerCase();
  for (const ext of TEXT_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function* walk(start) {
  let st;
  try {
    st = statSync(start);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (hasTextExt(start)) yield start;
    return;
  }
  if (!st.isDirectory()) return;

  const stack = [start];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(full);
      } else if (entry.isFile() && hasTextExt(entry.name)) {
        yield full;
      }
    }
  }
}

// A selector opening a nested scope that reads as a STATE/pseudo/attribute variant
// (&:hover, &::before, &[open], @starting-style, [disabled], .is-*) rather than a BEM
// element/modifier. references/approaches.md's SCSS-body ordering note treats "base
// property groups" and "base states" as separate top-to-bottom items — the 1–7 grouping
// discipline is for a rule's OWN base declaration set, not for a state's often-coupled
// 1-2 properties (e.g. a `h-0 opacity-0` closed-frame snapshot next to an
// `@starting-style` block). Both checks below are suppressed inside such a scope.
const STATE_SELECTOR_RE = /(&:{1,2}[\w-]|&\[|@starting-style|\[(open|disabled|checked)\]|\.is-[\w-]+)/;

// Extract, per line, the (braceDepth, applyUtilities[]) so we can track "consecutive
// @apply lines within the same rule" without a real CSS/SCSS parser — brace depth is
// enough to tell when we've left the rule (depth decreased) and should reset tracking.
function scanFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  if (text.includes('\0')) return;

  const lines = text.split(/\r\n|\r|\n/);
  let depth = 0;
  let lastGroupAtDepth = new Map(); // depth -> last seen group number, reset on depth decrease
  let stateDepths = new Set(); // depths whose enclosing scope is a state/pseudo variant

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    // A single-line nested rule (`&:hover { @apply bg-muted; }`) opens and closes on
    // the same line — net depth change is zero, but its @apply belongs to an isolated,
    // one-line scope, not to the enclosing block's sequence. Skip both checks for it
    // entirely (there is nothing to "split across lines" in an already-one-line rule).
    const isSingleLineNestedRule = opens > 0 && closes > 0 && /\{[^{}]*@apply[^{}]*\}/.test(line);

    const inStateScope = stateDepths.has(depth);

    const applyMatch = !isSingleLineNestedRule ? /@apply\s+([^;{}]+);?/.exec(line) : null;
    if (applyMatch) {
      const tokens = applyMatch[1].trim().split(/\s+/).filter(Boolean);
      const groups = [...new Set(tokens.map(classifyUtility).filter((g) => g !== null))];

      if (groups.length > 1 && !inStateScope) {
        findings.push({
          file, line: i + 1, match: applyMatch[0].trim(),
          what: `mixed property groups on one @apply line (groups ${groups.sort((a, b) => a - b).join(', ')})`,
          fix: 'split into one @apply line per group, in the fixed order 1–7 (resources/apply-grouping.md).',
        });
      }

      if (groups.length && !inStateScope) {
        const lowest = Math.min(...groups);
        const prev = lastGroupAtDepth.get(depth);
        if (prev !== undefined && lowest < prev) {
          findings.push({
            file, line: i + 1, match: applyMatch[0].trim(),
            what: `@apply group ${lowest} appears after group ${prev} in the same rule (out of order)`,
            fix: 'reorder @apply lines to follow the fixed group sequence 1–7 (resources/apply-grouping.md).',
          });
        }
        lastGroupAtDepth.set(depth, Math.max(lowest, prev ?? 0));
      }
    }

    if (!isSingleLineNestedRule && opens > 0 && STATE_SELECTOR_RE.test(line)) {
      stateDepths.add(depth + opens);
    }

    depth += opens;
    depth -= closes;
    if (closes > 0) {
      // Left one or more nested scopes — drop tracking for any depth we're no longer inside.
      for (const d of [...lastGroupAtDepth.keys()]) {
        if (d > depth) lastGroupAtDepth.delete(d);
      }
      for (const d of [...stateDepths]) {
        if (d > depth) stateDepths.delete(d);
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const targets = (args.length ? args : ['.']).map((p) => resolve(p));

  for (const target of targets) {
    for (const file of walk(target)) {
      scanFile(file);
    }
  }

  const cwd = process.cwd();
  for (const f of findings) {
    let rel = relative(cwd, f.file);
    if (rel.startsWith('..') || rel === '') rel = f.file;
    rel = rel.split(sep).join('/');
    console.log(`${rel}:${f.line}  ${f.match}`);
    console.log(`    ${f.what}`);
    console.log(`    -> ${f.fix}`);
    console.log('');
  }

  if (findings.length) {
    console.log(`lint-apply-grouping: found ${findings.length} grouping issue(s).`);
    process.exit(1);
  } else {
    console.log('lint-apply-grouping: no grouping issues found.');
    process.exit(0);
  }
}

main();
