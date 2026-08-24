import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
	},
})
