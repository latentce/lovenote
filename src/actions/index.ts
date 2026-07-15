import { account } from './account';
import { cachePurgeActions } from './cache-purges';
import { commentActions } from './comments';
import { favoriteActions } from './favorites';
import { postDeletionActions } from './post-deletion';
import { postLifecycleActions } from './post-lifecycle';
import { postActions } from './posts';
import { setup } from './setup';
import { tagActions } from './tags';
import { uploadActions } from './uploads';
import { userActions } from './users';

export const server = {
	account,
	cachePurges: cachePurgeActions,
	comments: commentActions,
	favorites: favoriteActions,
	postDeletion: postDeletionActions,
	postLifecycle: postLifecycleActions,
	posts: postActions,
	setup,
	tags: tagActions,
	uploads: uploadActions,
	users: userActions,
};
