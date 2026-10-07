import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { observationInclude, serializeObservation } from "../observations/service";
import { resolveSharedSpeciesProfile } from "../profiles/service";

type ActiveLink = {
  id: string;
  token: string;
  siteId: string;
  speciesId: string | null;
  ownerId: string;
  scope: string;
  expiresAt: Date;
};

async function getActiveLink(token: string): Promise<ActiveLink> {
  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }
  return link;
}

async function getSharedTimeline(link: ActiveLink) {
  if (link.scope !== "TIMELINE" && link.scope !== "TIMELINE_AND_COMPARE") {
    // 物种资料卡等其他范围的 token 不能在时间线视图里越权读取
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }

  const [site, owner, observations] = await Promise.all([
    prisma.site.findUniqueOrThrow({ where: { id: link.siteId } }),
    prisma.user.findUniqueOrThrow({ where: { id: link.ownerId }, select: { displayName: true } }),
    prisma.observation.findMany({
      where: { siteId: link.siteId, ownerId: link.ownerId, status: "PUBLISHED" },
      include: observationInclude,
      orderBy: [{ observationDate: "desc" }, { id: "desc" }],
      take: 500,
    }),
  ]);

  await prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } });

  return {
    kind: "TIMELINE" as const,
    site: {
      id: site.id,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      habitat: site.habitat,
      description: site.description,
    },
    owner: { displayName: owner.displayName },
    scope: link.scope,
    expiresAt: link.expiresAt,
    observations: observations.map(serializeObservation),
  };
}

/** 统一分享入口：同一个 /share/:token 按链接范围返回对应视图。 */
export async function getSharedView(token: string) {
  const link = await getActiveLink(token);
  if (link.scope === "SPECIES_PROFILE") {
    const result = await resolveSharedSpeciesProfile(token);
    return {
      kind: "SPECIES_PROFILE" as const,
      scope: result.link.scope,
      expiresAt: result.link.expiresAt,
      site: result.link.site,
      profile: result.profile,
    };
  }
  return getSharedTimeline(link);
}
