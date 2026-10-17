import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		// Live tests drive a real Firefox; run them with `npm run test:live`.
		exclude: ['tests/live/**', 'node_modules/**'],
	},
})
