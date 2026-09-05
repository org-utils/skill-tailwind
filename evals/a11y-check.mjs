#!/usr/bin/env node
// a11y-check.mjs — static accessibility checks that complement harness.mjs (axis 7).
//
// No dependencies — only Node built-in modules (node:fs, node:path). Runs offline,
// cross-platform (Windows/Unix), via `node` or `bun`.
//
// WHAT THIS IS. harness.mjs's axis-7 detectors already cover: focus-visible presence,
// outline-none without a ring replacement, <div onclick> instead of <button>, <input>
// without a label, and the invalid:/user-invalid: distinction (see harness.mjs
// checkA11yStates). This script does NOT repeat those — it checks a different,
// complementary slice of docs/accessibility.md that harness.mjs's axis 7 does not cover:
//
//   - motion:      animate-*/transition-* present without a motion-reduce: accommodation
//                  (docs/accessibility.md §7)
//   - aria pairs:  aria-expanded on a trigger without a matching aria-controls
//                  (docs/accessibility.md §4.2)
//   - aria-label:  an icon-only control with BOTH visible text and aria-label (redundant/
//                  conflicting accessible name — docs/accessibility.md §4.1)
//   - touch size:  icon-only interactive elements with no size/padding utility at all
//                  (heuristic only — see note below, docs/accessibility.md §2)
//
// HEURISTIC LIMITS (read before trusting a FAIL). This is markup-only static analysis:
// it cannot measure rendered box size, cannot resolve custom @utility/@apply classes back
// to their declarations, and cannot see when a design system's default control size
// already satisfies a rule. Touch-target findings are always WARN, never FAIL, for this
// reason. Treat every finding as a prompt to look, not as ground truth.
//
// Usage:
//   node evals/a11y-check.mjs <files...>            run specific files/folders
//   node evals/a11y-check.mjs --json <files...>     machine-readable JSON to stdout
//   node evals/a11y-check.mjs --quiet <files...>    summary only
//   node evals/a11y-check.mjs --strict-fixtures …   count fixtures too
//   (no arguments — current folder). exit 1 if there is at least one FAIL
//   in a non-fixture file (handy for CI), otherwise 0.
//
// Only .html/.htm files are scanned — these checks are about markup, not styles.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

/* ──────────────────────────── file walk ──────────────────────────── */

const TEXT_EXT = new Set(['.html', '.htm']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', '.astro', 'coverage', 'vendor', '.cache',
]);

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

/* ──────────────────────────── text utilities ─────────────────────────── */

const SEV = { FAIL: 'FAIL', WARN: 'WARN', INFO: 'INFO' };

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function isFixture(file, rawText) {
  const norm = file.split(sep).join('/');
  if (/\/fixtures\//.test(norm) || /(^|\/)fixtures$/.test(norm)) return true;
  const head = rawText.slice(0, 400);
  return /FIXTURE\s*[—-]\s*INPUT ONLY/i.test(head) || /INPUT ONLY/i.test(head);
}

// Very small tag scanner: finds opening tags and their attribute string + the
// text up to the matching close tag (non-nested — good enough for the single-line/
// short-block markup this skill's examples use). Not a real HTML parser.
function* elements(html, tagNames) {
  const re = new RegExp(`<(${tagNames.join('|')})\\b([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const start = m.index;
    // crude "inner text up to the next tag of the same family closing" — we only
    // need a short lookahead window for the text-content heuristic below.
    const windowEnd = Math.min(html.length, start + 400);
    const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
    const after = html.slice(m.index + m[0].length, windowEnd);
    const closeMatch = closeRe.exec(after);
    const inner = closeMatch ? after.slice(0, closeMatch.index) : after;
    yield { tag, attrs, start, inner, full: m[0] };
  }
}

function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return m[1] != null ? m[1] : m[2];
}

function lineOf(text, index) {
  if (index == null) return null;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/* ─────────────── check: motion without a reduced-motion accommodation ─────────────── */
// docs/accessibility.md §7: animate-*/transition-* should be paired with motion-reduce:
// somewhere in the file. File-level, not per-element — the accommodation is commonly
// declared once on a shared wrapper/utility, not repeated on every animated node.
function checkMotionReduce(text, push) {
  const hasAnimation = /\b(animate-(?!none\b)[\w-]+|transition(?:-[\w-]+)?)\b/.test(text) &&
    !/^\s*$/.test(text);
  const hasReducedMotionAccommodation = /\bmotion-reduce:/.test(text) ||
    /@media\s*\(\s*prefers-reduced-motion/.test(text);
  if (hasAnimation && !hasReducedMotionAccommodation) {
    push(SEV.WARN, null, 'animate-*/transition-*',
      'animation/transition utilities present with no motion-reduce: accommodation in the file',
      'add motion-reduce:transition-none (and/or motion-reduce:animate-none) per docs/accessibility.md §7.');
  }
}

/* ─────────────── check: aria-expanded without aria-controls ─────────────── */
// docs/accessibility.md §4.2: "Expanded/collapsed | aria-expanded + aria-controls".
function checkAriaExpandedControls(text, push) {
  for (const el of elements(text, ['button', 'a', 'summary', 'div', 'span'])) {
    if (attrValue(el.attrs, 'aria-expanded') == null) continue;
    if (attrValue(el.attrs, 'aria-controls') != null) continue;
    push(SEV.WARN, lineOf(text, el.start), 'aria-expanded',
      'aria-expanded without a matching aria-controls on the same trigger',
      'pair them: aria-expanded="…" aria-controls="<id of the controlled region>" (docs/accessibility.md §4.2).');
  }
}

/* ─────────────── check: icon-only control, redundant/conflicting name ─────────────── */
// docs/accessibility.md §4.1: aria-label is for "where there's no visible label". If the
// element already has visible text content, a second aria-label on top of it is either
// redundant (same text) or actively misleading (different text overrides what's read).
function checkRedundantAriaLabel(text, push) {
  for (const el of elements(text, ['button', 'a'])) {
    const ariaLabel = attrValue(el.attrs, 'aria-label');
    if (ariaLabel == null) continue;
    // Strip nested tags/attrs from inner content to approximate visible text; ignore
    // aria-hidden icons (svg/i/span with aria-hidden) which contribute no accessible text.
    const withoutHiddenIcons = el.inner.replace(/<[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    const visibleText = withoutHiddenIcons.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (visibleText.length > 0) {
      push(SEV.WARN, lineOf(text, el.start), 'aria-label',
        `aria-label="${ariaLabel}" set alongside visible text content ("${visibleText.slice(0, 40)}")`,
        'aria-label is for icon-only controls with no visible text; on a control that already has visible text, drop aria-label (or the text becomes an unused duplicate/conflicting name).');
    }
  }
}

/* ─────────────── check: icon-only control with no size/padding at all ─────────────── */
// Heuristic, WARN-only (see file header). We only flag the extreme case: an icon-only
// button/link (no meaningful visible text) with NONE of size-/p-/px-/py-/h-/w- present
// anywhere in its class list — i.e. nothing sizing the hit target at all.
function checkTouchTargetHeuristic(text, push) {
  const SIZE_RE = /\b(size-|p-\d|px-\d|py-\d|p-\[|h-\d|w-\d|h-\[|w-\[)/;
  for (const el of elements(text, ['button', 'a'])) {
    const cls = attrValue(el.attrs, 'class') || '';
    const withoutHiddenIcons = el.inner.replace(/<[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    const visibleText = withoutHiddenIcons.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const hasIcon = /<svg\b|<i\b|class="[^"]*\bicon\b/i.test(el.inner);
    const isIconOnly = hasIcon && visibleText.length === 0;
    if (isIconOnly && cls && !SIZE_RE.test(cls)) {
      push(SEV.WARN, lineOf(text, el.start), el.tag,
        'icon-only interactive element with no size/padding utility found on it',
        'give icon-only controls an explicit hit target (e.g. size-10 or p-2) — heuristic only, verify the rendered size (docs/accessibility.md §2).');
    }
  }
}

/* ──────────────────────────── file evaluation ───────────────────────────── */

function evalFile(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (raw.includes('\0')) return null; // binary

  const fixture = isFixture(file, raw);
  const code = stripHtmlComments(raw);

  const findings = [];
  const push = (sev, line, match, what, fix) => {
    findings.push({ sev, line, match, what, fix });
  };

  checkMotionReduce(code, push);
  checkAriaExpandedControls(code, push);
  checkRedundantAriaLabel(code, push);
  checkTouchTargetHeuristic(code, push);

  const fails = findings.filter((f) => f.sev === SEV.FAIL).length;
  const warns = findings.filter((f) => f.sev === SEV.WARN).length;

  let verdict; // 'pass' | 'partial' | 'fail'
  if (fails > 0) verdict = 'fail';
  else if (warns > 0) verdict = 'partial';
  else verdict = 'pass';

  return { file, fixture, findings, fails, warns, verdict };
}

/* ──────────────────────────── output ──────────────────────────────────── */

function relPath(file) {
  const cwd = process.cwd();
  let rel = relative(cwd, file);
  if (rel.startsWith('..') || rel === '') rel = file;
  return rel.split(sep).join('/');
}

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const paths = argv.filter((a) => !a.startsWith('--'));
  const asJson = flags.has('--json');
  const quiet = flags.has('--quiet');
  const strictFixtures = flags.has('--strict-fixtures');

  const targets = (paths.length ? paths : ['.']).map((p) => resolve(p));

  const results = [];
  for (const target of targets) {
    for (const file of walk(target)) {
      const r = evalFile(file);
      if (r) results.push(r);
    }
  }

  const scored = results.filter((r) => strictFixtures || !r.fixture);
  const anyFail = scored.some((r) => r.fails > 0);

  if (asJson) {
    const out = {
      summary: {
        files: results.length,
        scored: scored.length,
        pass: scored.filter((r) => r.verdict === 'pass').length,
        partial: scored.filter((r) => r.verdict === 'partial').length,
        fail: scored.filter((r) => r.verdict === 'fail').length,
        anyFail,
      },
      files: results.map((r) => ({
        file: relPath(r.file),
        fixture: r.fixture,
        verdict: r.verdict,
        counts: { fail: r.fails, warn: r.warns },
        findings: r.findings.map((f) => ({
          severity: f.sev, line: f.line, match: f.match, what: f.what, fix: f.fix,
        })),
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(anyFail ? 1 : 0);
  }

  for (const r of results) {
    const tag = r.fixture ? ' [INPUT/fixture — not counted]' : '';
    const head = `${relPath(r.file)} — ${r.verdict.toUpperCase()} (FAIL:${r.fails} WARN:${r.warns})${tag}`;
    if (quiet) {
      console.log(head);
      continue;
    }
    console.log(head);
    for (const f of r.findings) {
      const loc = f.line != null ? `:${f.line}` : '';
      console.log(`  ${f.sev}${loc}  ${f.match}`);
      console.log(`        ${f.what}`);
      console.log(`        -> ${f.fix}`);
    }
    console.log('');
  }

  const s = {
    files: results.length,
    scored: scored.length,
    pass: scored.filter((r) => r.verdict === 'pass').length,
    partial: scored.filter((r) => r.verdict === 'partial').length,
    fail: scored.filter((r) => r.verdict === 'fail').length,
  };
  console.log(
    `a11y-check: files ${s.files} (counted ${s.scored}) · ` +
    `pass ${s.pass} · partial ${s.partial} · fail ${s.fail}`,
  );
  if (results.length !== scored.length) {
    console.log(`         (${results.length - scored.length} fixture file(s) shown as INPUT and not counted)`);
  }
  process.exit(anyFail ? 1 : 0);
}

main();
