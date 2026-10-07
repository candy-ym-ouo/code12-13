import { z } from "zod";

export const speciesProfileQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
});

export const createSpeciesShareSchema = z.object({
  siteId: z.string().min(1, "请选择要限定的地点"),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

export type SpeciesProfileQuery = z.infer<typeof speciesProfileQuerySchema>;
export type CreateSpeciesShareInput = z.infer<typeof createSpeciesShareSchema>;
