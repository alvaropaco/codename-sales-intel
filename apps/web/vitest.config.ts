import { defineConfig } from 'vitest/config';
import path from 'path';

// Testes do onboarding conversacional (feature 004): apenas módulos puros
// (roteiro, serviço, reações) — sem DOM. Ver specs/004-ai-onboarding/plan.md.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
