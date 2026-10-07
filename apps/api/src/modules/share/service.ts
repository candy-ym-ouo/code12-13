import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { observationInclude, serializeObservation } from "../observations/service";

export async function getSharedView(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { site: true, owner: { select: { displayName: true } } },
  });

  if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }

  // 物种资料卡链接有独立入口，地点时间线接口不受理，避免范围串读。
  if (link.scope === "SPECIES_CARD" || !link.siteId) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }

  const siteId = link.siteId;
  const site = link.site;
  if (!site) throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");

  const observations = await prisma.observation.findMany({
    where: { siteId, ownerId: link.ownerId, status: "PUBLISHED" },
    include: observationInclude,
    orderBy: [{ observationDate: "desc" }, { id: "desc" }],
    take: 500,
  });

  await prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } });

  return {
    site: {
      id: site.id,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      habitat: site.habitat,
      description: site.description,
    },
    owner: { displayName: link.owner.displayName },
    scope: link.scope,
    expiresAt: link.expiresAt,
    observations: observations.map(serializeObservation),
  };
}
