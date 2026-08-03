/**
 * @vinkin/ledger — pure double-entry posting rules (Plan §18). Mock money in the
 * validation build, but production-grade rules: append-only, balanced, integer minor
 * units. Persistence (tables + enforcement triggers) lives in the API migrations; this
 * package only DECIDES what a posting looks like and proves it balances.
 */

export * from './accounts.ts';
export * from './postings.ts';
