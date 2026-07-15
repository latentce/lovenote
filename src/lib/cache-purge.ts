import { z } from 'zod';

export const retryCachePurgeInputSchema = z.object({
	jobId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
