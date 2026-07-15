import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { neon } from '@neondatabase/serverless';

if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

const sourceValue = process.env.DATABASE_URL?.trim();
if (!sourceValue) throw new Error('DATABASE_URL is required in .dev.vars.');

const sourceUrl = new URL(sourceValue);
const sourceDatabase = sourceUrl.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/u.test(sourceDatabase)) {
	throw new Error('Local integration reset is allowed only from a database whose name ends in _test.');
}

const integrationDatabase = `${sourceDatabase}_integration`;
const integrationUrl = new URL(sourceUrl);
integrationUrl.pathname = `/${integrationDatabase}`;

const admin = neon(sourceUrl.toString());
const quotedDatabase = `"${integrationDatabase}"`;
await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabase} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${quotedDatabase}`);

console.info(`Created empty disposable database ${integrationDatabase} on ${sourceUrl.hostname}.`);

const child = spawn('pnpm', ['test:integration'], {
	env: {
		...process.env,
		INTEGRATION_DATABASE_URL: integrationUrl.toString(),
	},
	stdio: 'inherit',
});

const exitCode = await new Promise<number>((resolve, reject) => {
	child.once('error', reject);
	child.once('exit', (code) => resolve(code ?? 1));
});
process.exitCode = exitCode;
