import { account } from './account';
import { commentActions } from './comments';
import { favoriteActions } from './favorites';
import { postDeletionActions } from './post-deletion';
import { postLifecycleActions } from './post-lifecycle';
import { postActions } from './posts';
import { setup } from './setup';
import { uploadActions } from './uploads';

export const server = {
	account,
	comments: commentActions,
	favorites: favoriteActions,
	postDeletion: postDeletionActions,
	postLifecycle: postLifecycleActions,
	posts: postActions,
	setup,
	uploads: uploadActions,
};
