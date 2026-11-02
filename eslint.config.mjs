/**
 * ESLint flat config for the Me2eM workspace (root-owned toolchain).
 *
 * Design notes:
 * - ONE config at the workspace root; per-package `lint` scripts run
 *   `eslint .` from their own directory — ESLint resolves this file by
 *   walking up from the current working directory, and `files`/`ignores`
 *   globs are matched against paths relative to THIS file's location, so
 *   the same rules apply no matter which package invokes them. This keeps
 *   a single eslint/typescript-eslint version for the whole workspace
 *   (declared in the root devDependencies) and satisfies both directions
 *   of the BL-34 gate: `pnpm -r lint` (CI) and per-package runs
 *   (e.g. before `pnpm publish` of a single package, DR-4 checklist).
 * - Base sets: `@eslint/js` recommended + `typescript-eslint` recommended
 *   (non-type-checked: parser-level TS awareness without projectService —
 *   type-checked linting is a possible later ratchet, not a gate).
 * - `@me2em/react` additionally gets `eslint-plugin-react-hooks`
 *   (flat/recommended, v7 — includes the compiler-derived correctness
 *   rules alongside the classic rules-of-hooks / exhaustive-deps).
 * - `packages/core/scripts/*.mjs` are plain Node scripts (no TS): Node
 *   globals are declared for them.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      // Generated TypeDoc output (minified assets) — not authored source.
      '**/docs/**',
      // bench/ and specs/ hold no lintable JS (JSON baselines, Markdown).
      '**/bench/**',
      'specs/**',
    ],
  },

  eslint.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Underscore-prefixed parameters/variables are the documented way
      // to mark intentionally unused bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: [
      'packages/react/src/**/*.{ts,tsx}',
      'packages/react/test/**/*.{ts,tsx}',
    ],
    ...reactHooks.configs.flat.recommended,
  },

  {
    files: ['packages/core/scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, console: 'readonly' },
    },
  },
);
