import { account } from './account';
import { commentActions } from './comments';
import { favoriteActions } from './favorites';
import { postActions } from './posts';
import { setup } from './setup';
import { uploadActions } from './uploads';

export const server = {
	account,
	comments: commentActions,
	favorites: favoriteActions,
	posts: postActions,
	setup,
	uploads: uploadActions,
};
