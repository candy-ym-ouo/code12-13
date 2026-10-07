import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { shareLimiter } from "../../middleware/rateLimit";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  cardQuerySchema,
  createCardShareSchema,
  listCardSharesQuerySchema,
  tokenParamsSchema,
  type CardQuery,
  type CreateCardShareInput,
} from "./schema";
import * as service from "./service";

const idParams = z.object({ id: z.string().min(1) });
const linkIdParams = z.object({ id: z.string().min(1), linkId: z.string().min(1) });

/** 物种资料卡：本人聚合视图与只读分享链接管理（全部需要登录）。 */
export const speciesCardRouter = Router();

speciesCardRouter.use(requireAuth);

speciesCardRouter.get(
  "/:id/card",
  validate({ params: idParams, query: cardQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const query = validatedQuery<CardQuery>(req);
    sendData(res, await service.getMySpeciesCard(currentUser(req).id, id, query));
  }),
);

speciesCardRouter.post(
  "/:id/card/share",
  validate({ params: idParams, body: createCardShareSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<CreateCardShareInput>(req);
    const link = await service.createCardShareLink(currentUser(req).id, id, body);
    sendData(res, link, undefined, 201);
  }),
);

speciesCardRouter.get(
  "/:id/card/share-links",
  validate({ params: idParams, query: listCardSharesQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const query = validatedQuery<{ siteId?: string }>(req);
    sendData(res, await service.listCardShareLinks(currentUser(req).id, id, query));
  }),
);

speciesCardRouter.delete(
  "/:id/card/share-links/:linkId",
  validate({ params: linkIdParams }),
  asyncHandler(async (req, res) => {
    const { id, linkId } = validatedParams<{ id: string; linkId: string }>(req);
    await service.revokeCardShareLink(currentUser(req).id, id, linkId);
    sendData(res, { ok: true });
  }),
);

/** 匿名只读入口：只能读取 token 限定的那一个物种（可选再限定到单个地点）。 */
export const speciesCardShareRouter = Router();

speciesCardShareRouter.get(
  "/:token",
  shareLimiter,
  validate({ params: tokenParamsSchema, query: z.object({ revision: z.string().min(8).max(64).optional() }) }),
  asyncHandler(async (req, res) => {
    const { token } = validatedParams<{ token: string }>(req);
    const { revision } = validatedQuery<{ revision?: string }>(req);
    sendData(res, await service.getSharedSpeciesCard(token, revision));
  }),
);
