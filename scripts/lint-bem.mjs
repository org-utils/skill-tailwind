#!/usr/bin/env node
// lint-bem.mjs — OPTIONAL detector of BEM naming-invariant violations (Approach B).
//
// The script is NOT required: the skill-tailwind skill works fully without it.
// No dependencies — only built-in Node modules (node:fs, node:path).
// Works offline, cross-platform (Windows/Unix), runnable via `node` or `bun`.
//
// What it checks — the THREE hard rules that hold regardless of which BEM naming
// scheme a project uses (see references/approaches.md "BEM naming schemes"):
//   1. A modifier class never appears alone on an element — it must sit alongside
//      its base block/element class on the same `class="..."` attribute.
//   2. No "elements of elements" — a class name must not chain two element
//      separators (e.g. `cardList-item-title` / `cardList__item__title`).
//   3. Names must be programmatically separable into block / element / modifier
//      under the selected scheme (see --scheme below) — a name that matches
//      no known separator shape is flagged as unparsable, not silently ignored.
//
// This is a HEURISTIC over class-attribute text, not a full BEM linter: it does not
// know which classes in a file are BEM vs. plain utility classes, so a class is only
// evaluated once it "looks like" BEM for the selected scheme (contains that scheme's
// element or modifier separator). Verify each flagged spot — false positives are
// possible when Approach A utility classes are mixed on the same element as Approach B
// BEM classes (which the skill explicitly allows for a light utility overlay).
//
// Usage:
//   node scripts/lint-bem.mjs [paths...]                  (defaults to the current folder)
//   node scripts/lint-bem.mjs --scheme=classic [paths...] (react|classic|two-dashes|camelcase; default: react)
//   exit 1 if anything is found (handy for CI), otherwise 0.
//
// See references/approaches.md ("BEM naming and separators", "BEM naming schemes")
// for the full rules this script encodes.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const TEXT_EXT = new Set(['.html', '.htm', '.scss', '.sass', '.css']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', '.astro', 'coverage', 'vendor', '.cache',
]);

// Element separator / modifier separator per scheme (references/approaches.md §"BEM naming schemes").
// The mod-value separator ("_") is not distinguished from the modifier separator here — both Classic
// and React use "_" for it, so splitting on the modifier separator once is sufficient for this check.
const SCHEMES = {
  react: { elem: '-', mod: '_', label: 'React (block-elem_mod, single-hyphen element)' },
  classic: { elem: '__', mod: '_', label: 'Classic (block__elem_mod)' },
  'two-dashes': { elem: '__', mod: '--', label: 'Two-Dashes (block__elem--mod)' },
  camelcase: { elem: '__', mod: '_', label: 'CamelCase (Block__Elem_Mod)' },
};

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

// Tailwind's own utility vocabulary is dense with "-" and often mixed onto the same
// element as BEM classes (Approach B explicitly allows a light utility overlay — see
// references/approaches.md §7). The React scheme's element separator is a single "-",
// which collides with virtually every multi-word Tailwind utility (`min-w-0`,
// `text-muted-foreground`, ...). Any variant-prefixed token (`hover:...`, `md:...`,
// `dark:...`) is unambiguously a utility, never a bare BEM class, in this skill's
// convention — and a broad prefix/keyword list below catches the rest. This is a
// denylist, not a parser: it only prevents false positives, it does not validate that
// a class outside the list IS a BEM class.
const TAILWIND_UTILITY_RE = new RegExp(
  '^(' +
    // dash-prefixed families (with or without a trailing value)
    '(bg|text|border|ring|ring-offset|w|h|min-w|min-h|max-w|max-h|size|aspect|' +
    'p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|space-x|space-y|' +
    'rounded|shadow|opacity|transition|duration|ease|delay|animate|cursor|overflow|' +
    'leading|tracking|whitespace|absolute|relative|fixed|sticky|static|inset|top|left|right|bottom|start|end|z|' +
    'flex|grid|col|row|place|items|justify|content|divide|outline|font|list|select|' +
    'pointer-events|resize|scroll|touch|appearance|from|via|to|fill|stroke|caret|accent|' +
    'decoration|backdrop|blur|brightness|contrast|grayscale|saturate|sepia|invert|filter|' +
    'scale|rotate|translate|skew|will-change|group|peer|aria|data|order|basis|shrink|grow|' +
    'columns|break|object|isolate|float|clear|align)-.*' +
    ')|(' +
    // standalone keywords (no trailing value)
    'block|inline|inline-block|inline-flex|inline-grid|hidden|table|flow-root|contents|' +
    'truncate|uppercase|lowercase|capitalize|italic|not-italic|underline|overline|line-through|' +
    'no-underline|antialiased|flex-1|flex-auto|flex-initial|flex-none|shrink|grow|sr-only|not-sr-only' +
    ')$'
);

function isLikelyTailwindUtility(cls) {
  if (cls.includes(':')) return true; // any variant-prefixed token (hover:, md:, dark:, group-*:) is a utility
  if (cls.includes('[')) return true; // arbitrary-value utility, e.g. top-[3px]
  const unsigned = cls.startsWith('-') ? cls.slice(1) : cls; // negative-value utility, e.g. -space-x-3
  return TAILWIND_UTILITY_RE.test(unsigned);
}

// Split one class token into { block, element, modifier } under a scheme, or null
// if it doesn't contain that scheme's element/modifier separator at all (i.e. it's
// probably not a BEM class — a plain utility, a block-only class, etc.) or if it
// matches the Tailwind-utility denylist above.
function parseBemClass(cls, scheme) {
  if (isLikelyTailwindUtility(cls)) return null;
  const { elem, mod } = scheme;
  const hasElem = cls.includes(elem);
  const hasMod = cls.includes(mod) && (elem === mod ? cls.split(mod).length > 2 : true);
  if (!hasElem && !hasMod) return null;

  let rest = cls;
  let modifier = null;
  const modIdx = rest.indexOf(mod, hasElem ? rest.indexOf(elem) + elem.length : 0);
  if (hasMod && modIdx !== -1) {
    modifier = rest.slice(modIdx + mod.length);
    rest = rest.slice(0, modIdx);
  }

  let block = rest;
  let element = null;
  const elemIdx = rest.indexOf(elem);
  if (hasElem && elemIdx !== -1) {
    block = rest.slice(0, elemIdx);
    element = rest.slice(elemIdx + elem.length);
  }

  return { block, element, modifier };
}

function checkLine(file, lineNo, line, scheme) {
  // class="a b c" / class='a b c' — also matches SCSS-side bare selectors like .block-elem_mod.
  const classAttrs = [...line.matchAll(/class\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const scssSelectors = [...line.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);

  for (const attr of classAttrs) {
    const classes = attr.split(/\s+/).filter(Boolean);
    const parsed = classes.map((c) => ({ raw: c, bem: parseBemClass(c, scheme) }));

    for (const { raw, bem } of parsed) {
      if (!bem) continue;

      // Rule: no elements of elements.
      if (bem.element && bem.element.includes(scheme.elem)) {
        findings.push({
          file, line: lineNo, match: raw,
          what: `element-of-element chain ("${bem.element}" contains another "${scheme.elem}" separator)`,
          fix: 'flatten to a single element from the block, or split into a new block (see references/approaches.md "No elements of elements").',
        });
      }

      // Rule: a modifier never stands alone — its base (block or block+element) must
      // also be present among the classes on this same element.
      if (bem.modifier) {
        const base = bem.element ? `${bem.block}${scheme.elem}${bem.element}` : bem.block;
        const hasBase = classes.includes(base) || classes.includes(bem.block);
        if (!hasBase) {
          findings.push({
            file, line: lineNo, match: raw,
            what: `modifier class used without its base class ("${base}") present on the same element`,
            fix: `add the base class alongside the modifier: class="${base} ${raw}".`,
          });
        }
      }
    }
  }

  // SCSS-side: nested selectors like .block-elem-elem or .block__elem__elem (element-of-element only —
  // "modifier stands alone" doesn't apply to selectors, only to markup class attributes).
  for (const sel of scssSelectors) {
    const bem = parseBemClass(sel, scheme);
    if (bem?.element && bem.element.includes(scheme.elem)) {
      findings.push({
        file, line: lineNo, match: `.${sel}`,
        what: `element-of-element chain in selector ("${bem.element}" contains another "${scheme.elem}" separator)`,
        fix: 'flatten to a single element from the block, or split into a new block.',
      });
    }
  }
}

function scanFile(file, scheme) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  if (text.includes('\0')) return;

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    checkLine(file, i + 1, lines[i], scheme);
  }
}

function main() {
  const rawArgs = process.argv.slice(2);
  let schemeName = 'react';
  const targets = [];
  for (const arg of rawArgs) {
    const m = /^--scheme=(.+)$/.exec(arg);
    if (m) {
      schemeName = m[1].toLowerCase();
    } else {
      targets.push(arg);
    }
  }
  const scheme = SCHEMES[schemeName];
  if (!scheme) {
    console.error(`lint-bem: unknown --scheme "${schemeName}". Known: ${Object.keys(SCHEMES).join(', ')}`);
    process.exit(2);
  }

  const resolvedTargets = (targets.length ? targets : ['.']).map((p) => resolve(p));
  for (const target of resolvedTargets) {
    for (const file of walk(target)) {
      scanFile(file, scheme);
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

  console.log(`lint-bem: scheme = ${scheme.label}`);
  if (findings.length) {
    console.log(`lint-bem: found ${findings.length} BEM naming violation(s).`);
    process.exit(1);
  } else {
    console.log('lint-bem: no BEM naming violations found.');
    process.exit(0);
  }
}

main();
