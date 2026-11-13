import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .tsx included from Build 6: the ErrorBoundary test renders JSX.
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
