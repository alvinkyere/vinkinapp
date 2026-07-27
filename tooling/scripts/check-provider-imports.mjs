#!/usr/bin/env node
/**
 * Provider-import CI guard (PV0 — docs/product-validation/00-governance.md §3).
 *
 * Fails when a prohibited financial-provider SDK is imported (or declared as a
 * dependency) anywhere outside an approved adapter directory. Zero dependencies;
 * run locally with: node tooling/scripts/check-provider-imports.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

/** Package names whose import outside an adapter directory fails the build. */
const PROHIBITED_PACKAGES = [
  'stripe',
  'lithic',
  'marqeta',
  'galileo-ftp',
  'unit',
  'treasuryprime',
  'plaid',
  'braintree',
  'square',
];
const PROHIBITED_SCOPES = [
  '@stripe',
  '@lithic',
  '@marqeta',
  '@unit-finance',
  '@treasuryprime',
  '@adyen',
  '@square',
];

/** The only directories where a provider SDK import may ever appear (post-M0-gate). */
const APPROVED_ADAPTER_DIRS = [
  join('packages', 'payment-provider', 'src', 'adapters'),
  join('packages', 'providers'),
];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo']);
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/** import/export-from/require/dynamic-import specifier extraction. */
const SPECIFIER_PATTERNS = [
  /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function isProhibited(specifier) {
  const scope = specifier.startsWith('@') ? specifier.split('/', 1)[0] : null;
  if (scope !== null) return PROHIBITED_SCOPES.includes(scope);
  const base = specifier.split('/', 1)[0];
  return PROHIBITED_PACKAGES.includes(base);
}

function isInApprovedAdapterDir(relPath) {
  return APPROVED_ADAPTER_DIRS.some((dir) => relPath.startsWith(dir + sep));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const violations = [];

for (const file of walk(repoRoot)) {
  const relPath = relative(repoRoot, file);

  if (relPath.endsWith(join(sep, 'package.json')) || relPath === 'package.json') {
    // ENG6 Slice 3 fix: a package.json's dependency declarations were checked
    // unconditionally, with no exemption for one that lives inside (or, for
    // packages/payment-provider, whose src/adapters subdirectory lives inside) an
    // approved adapter directory — meaning a provider SDK could never legally be
    // declared as a dependency ANYWHERE, contradicting this guard's own stated purpose
    // ("Provider SDKs are allowed only inside approved adapter directories"). Real bug,
    // caught while actually trying to add one for the first time (ENG6 Slice 3's Stripe
    // sandbox adapter, permitted under the M0 gate's D46 exception).
    if (isInApprovedAdapterDir(relPath)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const dep of Object.keys(manifest[section] ?? {})) {
        if (isProhibited(dep)) {
          violations.push(`${relPath}: prohibited ${section} entry "${dep}"`);
        }
      }
    }
    continue;
  }

  if (!SOURCE_EXTENSIONS.test(relPath) || isInApprovedAdapterDir(relPath)) continue;

  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!isProhibited(specifier)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(
        `${relPath}:${line}: prohibited provider import "${specifier}" — ${lines[line - 1]?.trim()}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Provider-import guard FAILED (docs/product-validation/00-governance.md §3):\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '\nProvider SDKs are allowed only inside approved adapter directories,' +
      '\nand only after the M0 gate permits that adapter:' +
      APPROVED_ADAPTER_DIRS.map((d) => `\n  ${d}${sep}<provider>${sep}`).join(''),
  );
  process.exit(1);
}

console.log(
  'Provider-import guard passed: no prohibited provider SDK outside approved adapter directories.',
);
