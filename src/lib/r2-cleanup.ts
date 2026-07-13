export async function deleteR2Objects(
	bucket: Pick<R2Bucket, 'delete'>,
	objectKeys: string[],
) {
	const uniqueKeys = [...new Set(objectKeys)];
	if (uniqueKeys.length === 0) return;

	await bucket.delete(uniqueKeys);
}
