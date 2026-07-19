import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // apps/guest-web and apps/operations-console (PV10/PV11, Next.js) lint separately via
    // their own `next lint` / eslint configs (React/JSX rules this root config doesn't
    // carry) — run `pnpm --filter @vinkin/guest-web lint` etc., same split as apps/mobile's
    // `flutter analyze`.
    ignores: [
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'apps/guest-web/**',
      'apps/operations-console/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The domain uses branded-type casts (`randomUUID() as VinkId`) deliberately.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['tooling/**/*.mjs', '**/*.test.ts', '**/seed.ts', '**/migrate.ts', '**/jobs/**'],
    languageOptions: {
      globals: { console: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
