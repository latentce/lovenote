import { existsSync } from 'node:fs';

import { verifyAcceptanceEnvironment } from './acceptance-environment';

if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

verifyAcceptanceEnvironment(process.env);

console.info('Full acceptance environment is configured.');
