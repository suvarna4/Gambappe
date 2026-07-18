// Shared ESLint flat config (design doc §3: ESLint + Prettier, config in packages/config).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/drizzle/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Contracts intentionally export many types; unused args prefixed with _ are fine.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Empty catch is used for best-effort cleanup paths; everything else must be handled.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Next.js generates this file with triple-slash references; it must not be edited.
    files: ['**/next-env.d.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
);
