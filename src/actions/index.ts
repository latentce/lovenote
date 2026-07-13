import { account } from './account';
import { postActions } from './posts';
import { setup } from './setup';
import { uploadActions } from './uploads';

export const server = {
	account,
	posts: postActions,
	setup,
	uploads: uploadActions,
};
