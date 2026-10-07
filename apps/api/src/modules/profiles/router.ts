import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { getOwnedSite, getOwnedSpecies } from "../../lib/access";
import { asyncHandler, sendData } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  createSpeciesShareSchema,
  speciesProfileQuerySchema,
  type CreateSpeciesShareInput,
  type SpeciesProfileQuery,
} from "./schema";
import * as service from "./service";

/** 登录态：查看物种资料卡、并可为"物种 × 地点"生成只读分享。 */
export const profileRouter = Router();

const speciesIdParams = z.object({ speciesId: z.string().min(1) });

profileRouter.use(requireAuth);

profileRouter.get(
  "/species/:speciesId",
  validate({ params: speciesIdParams, query: speciesProfileQuerySchema }),
  asyncHandler(async (req, res) => {
    const { speciesId } = validatedParams<{ speciesId: string }>(req);
    const query = validatedQuery<SpeciesProfileQuery>(req);
    sendData(res, await service.getSpeciesProfile(currentUser(req).id, speciesId, query.siteId));
  }),
);

/** 为"某物种 × 某地点"生成只读资料卡分享链接。 */
profileRouter.post(
  "/species/:speciesId/share",
  validate({ params: speciesIdParams, body: createSpeciesShareSchema }),
  asyncHandler(async (req, res) => {
    const userId = currentUser(req).id;
    const { speciesId } = validatedParams<{ speciesId: string }>(req);
    const input = validatedBody<CreateSpeciesShareInput>(req);

    await getOwnedSpecies(userId, speciesId);
    await getOwnedSite(userId, input.siteId);

    const token = crypto.randomBytes(16).toString("base64url");
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const link = await prisma.shareLink.create({
      data: {
        token,
        siteId: input.siteId,
        speciesId,
        ownerId: userId,
        scope: "SPECIES_PROFILE",
        expiresAt,
      },
    });

    sendData(
      res,
      {
        id: link.id,
        token: link.token,
        scope: link.scope,
        siteId: link.siteId,
        speciesId: link.speciesId,
        expiresAt: link.expiresAt,
        viewCount: link.viewCount,
        url: `${env.APP_ORIGIN.replace(/\/$/, "")}/share/${link.token}`,
      },
      undefined,
      201,
    );
  }),
);
