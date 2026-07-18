// Shared ESLint flat config (design doc §3: ESLint + Prettier, config in packages/config).
import jsxA11y from 'eslint-plugin-jsx-a11y';
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
      // Nested git worktrees for parallel background agents (never committed, see .gitignore) —
      // linting from the main worktree must not walk into another agent's live checkout.
      '.claude/worktrees/**',
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
  {
    // WS7-T1 a11y bar (design doc §10.4): interactive elements keyboard-operable, no
    // color-only signaling, labeled controls — enforced on every .tsx file, not just packages/ui.
    files: ['**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
);
