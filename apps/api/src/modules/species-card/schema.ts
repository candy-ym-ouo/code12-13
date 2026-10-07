import { z } from "zod";

/** 物种资料卡对外只读分享固定为 SPECIES_CARD 范围。 */
export const SPECIES_CARD_SCOPE = "SPECIES_CARD" as const;

export const cardQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
});

export const listCardSharesQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
});

export const createCardShareSchema = z.object({
  scope: z.literal(SPECIES_CARD_SCOPE),
  siteId: z.string().min(1).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

export const tokenParamsSchema = z.object({ token: z.string().min(8).max(64) });

export type CardQuery = z.infer<typeof cardQuerySchema>;
export type CreateCardShareInput = z.infer<typeof createCardShareSchema>;
