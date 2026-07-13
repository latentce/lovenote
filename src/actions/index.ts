import { account } from './account';
import { commentActions } from './comments';
import { postActions } from './posts';
import { setup } from './setup';
import { uploadActions } from './uploads';

export const server = {
	account,
	comments: commentActions,
	posts: postActions,
	setup,
	uploads: uploadActions,
};
