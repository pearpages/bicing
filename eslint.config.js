// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The package dependency graph from architecture.md (P10). Keys are element types
 * (one per package); values are the element types each may import.
 */
const allowedDependencies = {
  core: [],
  synthetic: ['core'],
  data: ['core', 'synthetic'],
  renderers: ['core'],
  charts: ['core', 'renderers'],
  vue: ['core', 'charts'],
  app: ['core', 'synthetic', 'data', 'renderers', 'charts', 'vue'],
  tool: ['core', 'synthetic', 'data'],
};

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', 'data/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  vue.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      // eslint-plugin-vue already sets vue-eslint-parser; it delegates <script lang="ts"> here.
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // Type-based optional props are already `undefined` when absent, and an explicit `undefined`
      // default is rejected by exactOptionalPropertyTypes. The rule targets runtime-declared props.
      'vue/require-default-prop': 'off',
      // TypeScript checks identifiers in SFCs (vue-tsc); core no-undef doesn't know browser globals.
      'no-undef': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Would rewrite the bounded typed-array reads that P14 allows (`arr[i] as number`) into `arr[i]!`.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/*/src/**', 'apps/*/src/**', 'tools/*/src/**'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        ...Object.keys(allowedDependencies)
          .filter((type) => type !== 'app' && type !== 'tool')
          .map((type) => ({ type, pattern: `packages/${type}` })),
        { type: 'app', pattern: 'apps/*' },
        { type: 'tool', pattern: 'tools/*' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // Third-party modules are governed by each package.json, not by the graph.
            { allow: { to: { module: { origin: 'external' } } } },
            { allow: { to: { module: { origin: 'core' } } } },
            ...Object.entries(allowedDependencies).map(([from, to]) => ({
              from: { element: { type: from } },
              allow: { to: { element: { types: { anyOf: [from, ...to] } } } },
            })),
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
