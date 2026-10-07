import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getOwnedSite, getOwnedSpecies } from "../../lib/access";
import { env } from "../../config/env";
import { dayOfYear } from "../../lib/date";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import { SPECIES_CARD_SCOPE, type CreateCardShareInput } from "./schema";

/**
 * 物种资料卡的口径全部在读取时实时聚合，不存任何快照：
 * 来源观测被删除、改期、改阶段、照片增删、阶段改名后，下一次打开链接即为最新结果，
 * 无需回填或失效任务；revision 是对聚合口径的短指纹，便于发现"数据已变化"。
 */

type CardPhoto = {
  id: string;
  observationId: string;
  observationDate: string;
  siteId: string;
  siteName: string;
  phenophaseId: string | null;
  phenophaseName: string | null;
  color: string | null;
  thumbUrl: string;
  displayUrl: string;
  width: number;
  height: number;
  takenAt: Date | null;
  sortOrder: number;
};

type CardObservation = Prisma.ObservationGetPayload<{ select: typeof CARD_OBSERVATION_SELECT }>;

const CARD_OBSERVATION_SELECT = {
  id: true,
  observationDate: true,
  siteId: true,
  phenophaseId: true,
  site: { select: { id: true, name: true } },
  phenophase: { select: { id: true, name: true, color: true } },
  photos: {
    select: {
      id: true,
      storageKey: true,
      thumbKey: true,
      displayKey: true,
      width: true,
      height: true,
      takenAt: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.ObservationSelect;

type BuildContext = {
  speciesId: string;
  siteId?: string | null;
  includePrivate?: boolean;
};

/** 资料卡只统计已发布观测，草稿永远不进入对外只读视图。 */
async function loadCardObservations({ speciesId, siteId }: BuildContext): Promise<CardObservation[]> {
  return prisma.observation.findMany({
    where: {
      speciesId,
      status: "PUBLISHED",
      ...(siteId ? { siteId } : {}),
    },
    select: CARD_OBSERVATION_SELECT,
    orderBy: [{ observationDate: "asc" }, { createdAt: "asc" }],
  });
}

function toCardPhoto(observation: CardObservation, photo: CardObservation["photos"][number]): CardPhoto {
  return {
    id: photo.id,
    observationId: observation.id,
    observationDate: observation.observationDate,
    siteId: observation.site.id,
    siteName: observation.site.name,
    phenophaseId: observation.phenophase?.id ?? null,
    phenophaseName: observation.phenophase?.name ?? null,
    color: observation.phenophase?.color ?? null,
    thumbUrl: storage.publicUrl(photo.thumbKey, "thumb"),
    displayUrl: storage.publicUrl(photo.displayKey, "display"),
    width: photo.width,
    height: photo.height,
    takenAt: photo.takenAt,
    sortOrder: photo.sortOrder,
  };
}

type PhaseFirst = {
  year: number;
  firstDate: string;
  dayOfYear: number;
  observationId: string | null;
};

export type SpeciesCard = {
  kind: "SPECIES_CARD";
  species: {
    id: string;
    category: string;
    commonName: string;
    scientificName: string | null;
    family: string | null;
    description: string | null;
  };
  scope: { siteId: string | null; siteName: string | null };
  phenophases: Array<{
    id: string;
    name: string;
    color: string;
    orderIndex: number;
    isDefault: boolean;
    observationCount: number;
    firstSeen: { date: string; dayOfYear: number } | null;
    lastSeen: { date: string } | null;
    years: number[];
  }>;
  /** 历年首现：该物种（不限物候阶段）每年最早的一条记录。 */
  firstAppearances: Array<{
    year: number;
    firstDate: string;
    dayOfYear: number;
    phenophaseId: string | null;
    phenophaseName: string | null;
    color: string | null;
    observationId: string | null;
    photoCount: number;
  }>;
  years: Array<{ year: number; observationCount: number; photoCount: number }>;
  photos: Array<CardPhoto & { originalUrl?: string }>;
  stats: {
    observationCount: number;
    photoCount: number;
    siteCount: number;
    yearCount: number;
    firstObservationDate: string | null;
    lastObservationDate: string | null;
  };
  revision: string;
  generatedAt: string;
};

/**
 * 聚合资料卡。includePrivate=true（本人查看）返回观测 id 与原图地址，
 * 可跳转详情；对外只读分享（includePrivate=false）剥离这些字段。
 */
export async function buildSpeciesCard(context: BuildContext): Promise<SpeciesCard> {
  const species = await prisma.species.findUnique({
    where: { id: context.speciesId },
    include: { phenophases: { orderBy: { orderIndex: "asc" } } },
  });
  if (!species) throw new ApiError(404, "NOT_FOUND", "物种不存在");

  const scopeSite = context.siteId ? await prisma.site.findUnique({ where: { id: context.siteId } }) : null;
  if (context.siteId && !scopeSite) throw new ApiError(404, "NOT_FOUND", "地点不存在");

  const observations = await loadCardObservations(context);

  // 每个物候阶段的首/末现与年份（未标注阶段的观测不归属任何阶段）。
  const phaseStats = new Map<
    string,
    { first: CardObservation | null; last: CardObservation | null; years: Set<number>; count: number }
  >();
  const firstByPhaseYear = new Map<string, Map<number, PhaseFirst>>();
  const firstByYear = new Map<number, CardObservation>();
  const yearCounts = new Map<number, { observationCount: number; photoCount: number }>();
  const siteIds = new Set<string>();

  for (const observation of observations) {
    const year = Number(observation.observationDate.slice(0, 4));
    siteIds.add(observation.site.id);

    const yearEntry = yearCounts.get(year) ?? { observationCount: 0, photoCount: 0 };
    yearEntry.observationCount += 1;
    yearEntry.photoCount += observation.photos.length;
    yearCounts.set(year, yearEntry);

    if (!firstByYear.has(year)) firstByYear.set(year, observation);

    if (observation.phenophase) {
      const phaseId = observation.phenophase.id;
      const entry = phaseStats.get(phaseId) ?? { first: null, last: null, years: new Set(), count: 0 };
      entry.count += 1;
      entry.years.add(year);
      if (!entry.first || observation.observationDate < entry.first.observationDate) entry.first = observation;
      if (!entry.last || observation.observationDate > entry.last.observationDate) entry.last = observation;
      phaseStats.set(phaseId, entry);

      const perYear = firstByPhaseYear.get(phaseId) ?? new Map<number, PhaseFirst>();
      if (!perYear.has(year)) {
        perYear.set(year, {
          year,
          firstDate: observation.observationDate,
          dayOfYear: dayOfYear(observation.observationDate),
          observationId: observation.id,
        });
      }
      firstByPhaseYear.set(phaseId, perYear);
    }
  }

  const phenophases = species.phenophases.map((phase) => {
    const stats = phaseStats.get(phase.id);
    const perYear = firstByPhaseYear.get(phase.id);
    return {
      id: phase.id,
      name: phase.name,
      color: phase.color,
      orderIndex: phase.orderIndex,
      isDefault: phase.isDefault,
      observationCount: stats?.count ?? 0,
      firstSeen: stats?.first
        ? { date: stats.first.observationDate, dayOfYear: dayOfYear(stats.first.observationDate) }
        : null,
      lastSeen: stats?.last ? { date: stats.last.observationDate } : null,
      years: perYear ? [...perYear.keys()].sort((a, b) => a - b) : [],
    };
  });

  const firstAppearances = [...firstByYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, observation]) => ({
      year,
      firstDate: observation.observationDate,
      dayOfYear: dayOfYear(observation.observationDate),
      phenophaseId: observation.phenophase?.id ?? null,
      phenophaseName: observation.phenophase?.name ?? null,
      color: observation.phenophase?.color ?? null,
      observationId: context.includePrivate ? observation.id : null,
      photoCount: observation.photos.length,
    }));

  const years = [...yearCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, counts]) => ({ year, ...counts }));

  // 照片按拍摄日期优先、其次观测日期、最后记录创建顺序排列。
  const photos = observations
    .flatMap((observation) =>
      [...observation.photos]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((photo) => ({ observation, photo })),
    )
    .sort((a, b) => {
      const at = a.photo.takenAt?.getTime() ?? null;
      const bt = b.photo.takenAt?.getTime() ?? null;
      if (at !== null && bt !== null && at !== bt) return at - bt;
      if (at !== bt) return at === null ? 1 : -1;
      const dateCompare = a.observation.observationDate.localeCompare(b.observation.observationDate);
      if (dateCompare !== 0) return dateCompare;
      return a.photo.sortOrder - b.photo.sortOrder;
    })
    .map(({ observation, photo }) => {
      const cardPhoto = toCardPhoto(observation, photo);
      return context.includePrivate
        ? { ...cardPhoto, originalUrl: storage.publicUrl(photo.storageKey, "original") }
        : cardPhoto;
    });

  const stats = {
    observationCount: observations.length,
    photoCount: photos.length,
    siteCount: siteIds.size,
    yearCount: firstByYear.size,
    firstObservationDate: observations[0]?.observationDate ?? null,
    lastObservationDate: observations[observations.length - 1]?.observationDate ?? null,
  };

  return {
    kind: "SPECIES_CARD",
    species: {
      id: species.id,
      category: species.category,
      commonName: species.commonName,
      scientificName: species.scientificName,
      family: species.family,
      description: species.description,
    },
    scope: { siteId: context.siteId ?? null, siteName: scopeSite?.name ?? null },
    phenophases,
    firstAppearances,
    years,
    photos,
    stats,
    revision: computeRevision(observations),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 口径指纹：对每条来源记录的日期/阶段/更新时间与照片主键做哈希。
 * 删除、改期、改阶段、增删照片都会改变 revision（createdAt/updatedAt 由数据库维护）。
 */
function computeRevision(observations: CardObservation[]): string {
  const parts = observations.map(
    (observation) =>
      [
        observation.id,
        observation.observationDate,
        observation.phenophaseId ?? "∅",
        observation.photos.map((photo) => photo.id).join(","),
      ].join("|"),
  );
  return crypto.createHash("sha256").update(parts.join("\n")).digest("base64url").slice(0, 16);
}

export async function getMySpeciesCard(
  userId: string,
  speciesId: string,
  query: { siteId?: string },
): Promise<SpeciesCard> {
  await getOwnedSpecies(userId, speciesId);
  if (query.siteId) await getOwnedSite(userId, query.siteId);
  return buildSpeciesCard({ speciesId, siteId: query.siteId ?? null, includePrivate: true });
}

function cardShareUrl(token: string): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/species-share/${token}`;
}

export async function createCardShareLink(userId: string, speciesId: string, input: CreateCardShareInput) {
  await getOwnedSpecies(userId, speciesId);
  if (input.siteId) await getOwnedSite(userId, input.siteId);

  const token = crypto.randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  const link = await prisma.shareLink.create({
    data: {
      token,
      speciesId,
      siteId: input.siteId ?? null,
      ownerId: userId,
      scope: SPECIES_CARD_SCOPE,
      expiresAt,
    },
  });

  return {
    id: link.id,
    token: link.token,
    scope: link.scope,
    siteId: link.siteId,
    expiresAt: link.expiresAt,
    viewCount: link.viewCount,
    url: cardShareUrl(link.token),
  };
}

export async function listCardShareLinks(
  userId: string,
  speciesId: string,
  query: { siteId?: string },
) {
  await getOwnedSpecies(userId, speciesId);
  const links = await prisma.shareLink.findMany({
    where: {
      speciesId,
      ownerId: userId,
      scope: SPECIES_CARD_SCOPE,
      ...(query.siteId ? { siteId: query.siteId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return links.map((link) => ({
    id: link.id,
    token: link.token,
    scope: link.scope,
    siteId: link.siteId,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    viewCount: link.viewCount,
    url: cardShareUrl(link.token),
  }));
}

export async function revokeCardShareLink(userId: string, speciesId: string, linkId: string): Promise<void> {
  const link = await prisma.shareLink.findFirst({
    where: { id: linkId, speciesId, ownerId: userId, scope: SPECIES_CARD_SCOPE },
  });
  if (!link) throw new ApiError(404, "NOT_FOUND", "分享链接不存在");
  await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
}

/** 匿名只读访问：校验 token / 有效期 / 撤销状态后，严格按链接限定范围实时聚合。 */
export async function getSharedSpeciesCard(token: string, revision?: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { owner: { select: { displayName: true } } },
  });

  if (!link || link.scope !== SPECIES_CARD_SCOPE || !link.speciesId) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }
  if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }

  const card = await buildSpeciesCard({ speciesId: link.speciesId, siteId: link.siteId, includePrivate: false });

  await prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } });

  return {
    card,
    owner: { displayName: link.owner.displayName },
    share: {
      scope: link.scope,
      expiresAt: link.expiresAt,
      viewCount: link.viewCount + 1,
      unchanged: revision !== undefined ? revision === card.revision : undefined,
    },
  };
}
