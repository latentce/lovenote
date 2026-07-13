import { z } from 'zod';

export const toggleFavoriteInputSchema = z.object({
	postId: z.coerce.number().int().positive(),
});

export type ToggleFavoriteInput = z.infer<typeof toggleFavoriteInputSchema>;
