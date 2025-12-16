import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_?' }],
      '@typescript-eslint/no-require-imports': 'off',
      // Require named catch clause parameters (no empty catches)
      // Use _error or _e for intentionally ignored errors
      'no-unused-vars': 'off', // Handled by @typescript-eslint/no-unused-vars
    },
  },
  {
    // Stricter rules for production code (not tests)
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/**/*.test.ts'],
    rules: {
      // Warn on floating promises (async without await)
      '@typescript-eslint/no-floating-promises': 'off', // Enable later after fixing
      // Warn on explicit any - work towards reducing
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
)
