import { ActionError, defineAction } from 'astro:actions';
import { env } from 'cloudflare:workers';

import {
	createOwner,
	setupInputSchema,
	verifySetupSecret,
} from '../lib/setup';

export const setup = {
	create: defineAction({
		accept: 'form',
		input: setupInputSchema,
		handler: async ({ confirmPassword: _confirmPassword, setupSecret, ...input }, { locals }) => {
			if (!env.SETUP_SECRET) {
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Owner setup is not configured.',
				});
			}

			if (!(await verifySetupSecret(setupSecret, env.SETUP_SECRET))) {
				throw new ActionError({
					code: 'UNAUTHORIZED',
					message: 'The setup secret is invalid.',
				});
			}

			const userId = await createOwner(locals.database, input);

			if (!userId) {
				throw new ActionError({
					code: 'CONFLICT',
					message: 'Owner setup has already been completed.',
				});
			}

			console.info(JSON.stringify({ event: 'setup.owner_created', userId }));

			return { created: true };
		},
	}),
};
