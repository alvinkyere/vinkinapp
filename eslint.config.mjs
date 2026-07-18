import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
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
