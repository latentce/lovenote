import { account } from './account';
import { postActions } from './posts';
import { setup } from './setup';

export const server = {
	account,
	posts: postActions,
	setup,
};
