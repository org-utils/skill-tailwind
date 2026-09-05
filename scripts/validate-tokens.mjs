#!/usr/bin/env node
// validate-tokens.mjs — OPTIONAL detector of @theme / design-token misuse.
//
// The script is NOT required: the skill-tailwind skill works fully without it.
// No dependencies — only built-in Node modules (node:fs, node:path).
// Works offline, cross-platform (Windows/Unix), runnable via `node` or `bun`.
//
// What it checks:
//   1. Dark-mode contrast pairing (docs/dark-mode.md §8 / templates/theme.css comment):
//      every `--color-X` token that has a paired `--color-X-foreground` token in an
//      `@theme` block must ALSO have both re-declared inside a `.dark { ... }` override.
//      A token pair with no dark override silently keeps its light value in dark mode —
//      the classic near-white-text-on-light-fill contrast bug.
//   2. Arbitrary hardcoded colors in consumers: `bg-[#fff]`, `text-[#000]`,
//      `border-[rgb(...)]` etc. in .html/.scss files OTHER than the theme file itself —
//      a project's own color VALUES belong in @theme (as token overrides), not scattered
//      as arbitrary values in markup/@apply (references/tokens.md, resources/anti-patterns.md).
//   3. (INFO, not a failure) tokens declared in @theme that this run never saw referenced
//      by name (as a `-<token>` utility or `var(--color-<token>)`) in any other scanned
//      file — a heads-up for dead tokens, not proof of dead code (this run may not see
//      every consumer; only trust it across the full project, not a subset of files).
//
// Usage:
//   node scripts/validate-tokens.mjs [paths...]   (defaults to the current folder)
//   exit 1 only on FAIL findings (#1 and #2); #3 is informational and does not affect exit code.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const THEME_EXT = new Set(['.css']);
const CONSUMER_EXT = new Set(['.html', '.htm', '.scss', '.sass', '.css']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', '.astro', 'coverage', 'vendor', '.cache',
]);

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function* walk(start, extSet) {
  let st;
  try {
    st = statSync(start);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (extSet.has(extOf(start))) yield start;
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
      } else if (entry.isFile() && extSet.has(extOf(entry.name))) {
        yield full;
      }
    }
  }
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function readSafe(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

// Extract `--color-<name>: <value>;` declarations inside the FIRST top-level `@theme { ... }`
// block, and separately inside the FIRST top-level `.dark { ... }` block (brace-depth walk,
// not a real CSS parser — matches this skill's existing script conventions).
function extractBlockVars(text, blockStartRe) {
  const start = blockStartRe.exec(text);
  if (!start) return null;
  let i = text.indexOf('{', start.index);
  if (i === -1) return null;
  let depth = 1;
  let j = i + 1;
  for (; j < text.length && depth > 0; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') depth--;
  }
  const body = text.slice(i + 1, j - 1);
  const vars = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim());
  }
  return vars;
}

const findings = [];
const infos = [];

function checkThemeFile(file) {
  const text = readSafe(file);
  if (!text) return null;

  const themeVars = extractBlockVars(text, /@theme\s*\{/);
  if (!themeVars) return null; // not a theme file — no @theme block

  const darkVars = extractBlockVars(text, /\.dark\s*\{/) ?? new Map();

  // Pair up --color-X / --color-X-foreground and check both exist in .dark.
  const colorNames = new Set(
    [...themeVars.keys()].filter((k) => k.startsWith('--color-') && !k.endsWith('-foreground'))
  );
  for (const base of colorNames) {
    const fg = `${base}-foreground`;
    if (!themeVars.has(fg)) continue; // not a contrast pair, nothing to check

    const missing = [];
    if (!darkVars.has(base)) missing.push(base);
    if (!darkVars.has(fg)) missing.push(fg);
    if (missing.length) {
      findings.push({
        file, line: null, match: `${base} / ${fg}`,
        what: `contrast-pair token(s) missing a .dark override: ${missing.join(', ')}`,
        fix: 'add both tokens to the .dark { ... } block so the pair keeps contrast in dark mode too (docs/dark-mode.md §8).',
      });
    }
  }

  return { themeVars, file };
}

function checkConsumerFile(file, themeFileNames) {
  if (themeFileNames.has(file)) return; // don't flag the theme file's own token definitions
  const text = readSafe(file);
  if (!text) return;

  const lines = text.split(/\r\n|\r|\n/);
  const arbitraryColorRe = /\b(bg|text|border|ring|fill|stroke|from|via|to|divide|outline|caret|accent|shadow)-\[(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\]/g;

  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(arbitraryColorRe)) {
      findings.push({
        file, line: i + 1, match: m[0],
        what: 'arbitrary hardcoded color value in a utility class',
        fix: 'map the value into @theme as a semantic token and use the token utility instead (references/tokens.md).',
      });
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const targets = (args.length ? args : ['.']).map((p) => resolve(p));

  const themeFiles = new Set();
  const allThemeVars = new Map(); // token name -> Set(files it's declared in)

  for (const target of targets) {
    for (const file of walk(target, THEME_EXT)) {
      const result = checkThemeFile(file);
      if (result) {
        themeFiles.add(file);
        for (const name of result.themeVars.keys()) {
          if (!allThemeVars.has(name)) allThemeVars.set(name, []);
          allThemeVars.get(name).push(file);
        }
      }
    }
  }

  const allText = [];
  for (const target of targets) {
    for (const file of walk(target, CONSUMER_EXT)) {
      checkConsumerFile(file, themeFiles);
      const text = readSafe(file);
      if (text) allText.push(text);
    }
  }

  // INFO: tokens declared but never referenced (as -<name> utility or var(--...)) in any
  // scanned file, theme file included (an override consumes the base name too).
  const haystack = allText.join('\n');
  for (const [varName] of allThemeVars) {
    if (!varName.startsWith('--color-') && !varName.startsWith('--font-') && !varName.startsWith('--radius-')) continue;
    const short = varName.replace(/^--(color|font|radius)-/, '');
    const usedAsUtility = new RegExp(`[:\\s"'\`]${short}\\b`).test(haystack.replace(varName, ''));
    const usedAsVar = haystack.includes(`var(${varName})`);
    if (!usedAsUtility && !usedAsVar) {
      infos.push(`${varName}: no reference found across scanned files (may be a false positive — see script header)`);
    }
  }

  const cwd = process.cwd();
  for (const f of findings) {
    let rel = f.file ? relative(cwd, f.file) : '';
    if (rel.startsWith('..') || rel === '') rel = f.file ?? '';
    rel = rel.split(sep).join('/');
    console.log(f.line ? `${rel}:${f.line}  ${f.match}` : `${rel}  ${f.match}`);
    console.log(`    ${f.what}`);
    console.log(`    -> ${f.fix}`);
    console.log('');
  }

  if (infos.length) {
    console.log('--- INFO: possibly unused tokens (does not affect exit code) ---');
    for (const line of infos) console.log(`  ${line}`);
    console.log('');
  }

  if (findings.length) {
    console.log(`validate-tokens: found ${findings.length} issue(s).`);
    process.exit(1);
  } else {
    console.log('validate-tokens: no issues found.');
    process.exit(0);
  }
}

main();
