import { createDatabase } from '../src/db/client';
import { recoverOwnerPassword } from '../src/db/owner-recovery';
import { passwordHasher } from '../src/lib/password-hasher';
import { passwordValueSchema } from '../src/lib/password';

async function readStdin() {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function readHiddenPassword(prompt: string) {
	if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
		throw new Error('A terminal is required for the interactive password prompt.');
	}

	process.stdout.write(prompt);
	process.stdin.setEncoding('utf8');
	process.stdin.setRawMode(true);
	process.stdin.resume();

	return new Promise<string>((resolve, reject) => {
		let password = '';

		const finish = (error?: Error) => {
			process.stdin.off('data', onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdout.write('\n');
			if (error) reject(error);
			else resolve(password);
		};

		const onData = (input: string) => {
			for (const character of input) {
				if (character === '\u0003') {
					finish(new Error('Owner recovery cancelled.'));
					return;
				}
				if (character === '\r' || character === '\n') {
					finish();
					return;
				}
				if (character === '\u007f' || character === '\b') {
					if (password.length > 0) {
						password = password.slice(0, -1);
						process.stdout.write('\b \b');
					}
					continue;
				}
				if (character >= ' ') {
					password += character;
					process.stdout.write('*');
				}
			}
		};

		process.stdin.on('data', onData);
	});
}

async function getNewPassword() {
	if (!process.stdin.isTTY) {
		return readStdin();
	}

	const password = await readHiddenPassword('New owner password: ');
	const confirmation = await readHiddenPassword('Confirm owner password: ');
	if (password !== confirmation) {
		throw new Error('Passwords do not match.');
	}

	return password;
}

async function main() {
	if (process.argv.length > 2) {
		throw new Error('Pass the password through the hidden prompt or standard input, not arguments.');
	}

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required.');
	}

	const password = passwordValueSchema.parse(await getNewPassword());
	const passwordHash = await passwordHasher.hash(password);
	const recovered = await recoverOwnerPassword(createDatabase(databaseUrl), passwordHash);
	if (!recovered) {
		throw new Error('Expected exactly one owner with a credential account.');
	}

	process.stdout.write(
		`Owner password recovered. Revoked ${recovered.sessionsRevoked} active session${recovered.sessionsRevoked === 1 ? '' : 's'}.\n`,
	);
}

main().catch((error: unknown) => {
	const message =
		typeof error === 'object' && error !== null && 'issues' in error
			? String((error as { issues?: Array<{ message?: string }> }).issues?.[0]?.message ?? 'Invalid password.')
			: error instanceof Error
				? error.message
				: 'Owner recovery failed.';
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
