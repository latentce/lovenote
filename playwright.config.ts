import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.E2E_BASE_URL;
const localBaseUrl = 'http://127.0.0.1:4321';

export default defineConfig({
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	outputDir: 'test-results',
	reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
	retries: process.env.CI ? 2 : 0,
	testDir: './tests/e2e',
	timeout: 60_000,
	use: {
		baseURL: externalBaseUrl ?? localBaseUrl,
		trace: 'retain-on-failure',
	},
	webServer: externalBaseUrl
		? undefined
		: {
				command: 'pnpm preview --host 127.0.0.1 --port 4321',
				reuseExistingServer: !process.env.CI,
				stderr: 'pipe',
				stdout: 'pipe',
				timeout: 120_000,
				url: `${localBaseUrl}/login`,
			},
	workers: 1,
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
