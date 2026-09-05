#!/usr/bin/env node
// cli.mjs — single entry point wrapping every optional script/evaluator in this skill.
//
// No dependencies — spawns the existing zero-dependency scripts as child processes with
// the current runtime (works under `node` or `bun` — whichever ran this file runs the rest).
// This does NOT replace running the scripts directly; it's a convenience wrapper so the
// skill can be driven as one command (`skill-tailwind <subcommand> [...args]`) once
// installed, e.g. via `bin` in package.json (see ../package.json).
//
// Subcommands:
//   check-v3     -> scripts/check-v3-antipatterns.mjs   (v3->v4 syntax detector)
//   lint-dynamic -> scripts/lint-dynamic-classes.mjs     (dynamically-assembled class names)
//   lint-bem     -> scripts/lint-bem.mjs                 (BEM naming invariants)
//   lint-apply   -> scripts/lint-apply-grouping.mjs      (@apply group order)
//   tokens       -> scripts/validate-tokens.mjs          (@theme / dark-pair validation)
//   gen-types    -> scripts/generate-token-types.mjs     (TypeScript codegen from @theme)
//   review       -> evals/harness.mjs                    (behavioral eval harness)
//   a11y         -> evals/a11y-check.mjs                 (accessibility static checks)
//   all          -> runs check-v3, lint-dynamic, lint-bem, lint-apply, tokens, review, a11y
//                   in sequence against the given paths; exits 1 if any of them did.
//
// Usage:
//   node scripts/cli.mjs <subcommand> [paths/flags...]
//   node scripts/cli.mjs all [paths...]
//
// Honesty note: this is a LOCAL convenience wrapper living in this git repo, not a
// package published to the npm registry. See package.json's "bin" field for how a
// maintainer could publish it as one; nothing here assumes it already is published.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SUBCOMMANDS = {
  'check-v3': join(root, 'scripts', 'check-v3-antipatterns.mjs'),
  'lint-dynamic': join(root, 'scripts', 'lint-dynamic-classes.mjs'),
  'lint-bem': join(root, 'scripts', 'lint-bem.mjs'),
  'lint-apply': join(root, 'scripts', 'lint-apply-grouping.mjs'),
  tokens: join(root, 'scripts', 'validate-tokens.mjs'),
  'gen-types': join(root, 'scripts', 'generate-token-types.mjs'),
  review: join(root, 'evals', 'harness.mjs'),
  a11y: join(root, 'evals', 'a11y-check.mjs'),
};

const ALL_ORDER = ['check-v3', 'lint-dynamic', 'lint-bem', 'lint-apply', 'tokens', 'review', 'a11y'];

function run(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log('Usage: cli.mjs <' + [...Object.keys(SUBCOMMANDS), 'all'].join('|') + '> [paths/flags...]');
    process.exit(cmd ? 0 : 2);
  }

  if (cmd === 'all') {
    let failed = false;
    for (const name of ALL_ORDER) {
      console.log(`\n=== ${name} ===`);
      const status = run(SUBCOMMANDS[name], rest);
      if (status !== 0) failed = true;
    }
    process.exit(failed ? 1 : 0);
  }

  const scriptPath = SUBCOMMANDS[cmd];
  if (!scriptPath) {
    console.error(`cli.mjs: unknown subcommand "${cmd}". Known: ${Object.keys(SUBCOMMANDS).join(', ')}, all`);
    process.exit(2);
  }

  process.exit(run(scriptPath, rest));
}

main();
