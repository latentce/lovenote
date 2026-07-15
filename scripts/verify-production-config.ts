import { readFile } from 'node:fs/promises';

import { verifyProductionConfig } from '../src/lib/production-config';

const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
let rawConfig: unknown;
try {
	rawConfig = JSON.parse(source);
} catch (error) {
	throw new Error('wrangler.jsonc must remain valid JSON for the production preflight.', {
		cause: error,
	});
}

verifyProductionConfig(rawConfig);
console.info('Production Wrangler configuration is ready for deployment.');
