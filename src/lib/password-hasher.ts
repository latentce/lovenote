import { hashPassword, verifyPassword } from 'better-auth/crypto';

export const passwordHasher = {
	hash: hashPassword,
	verify: verifyPassword,
};
