import type { Prisma } from "@prisma/client";
import { ApiError } from "../../lib/http";
import { buildPhenologySeries, describeOffset } from "../../lib/phenology";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import {
  observationInclude,
  serializeObservation,
  type ObservationWithRelations,
} from "../observations/service";

/**
 * 物种资料卡：把同一物种在多个地点的已发布观测汇总成一张卡——
 * 照片墙、物候阶段清单、以及"按物候阶段 × 年份"的历年首现日。
 *
 * 口径说明（与时间线 / 对比页保持一致）：
 * - 只统计 status = PUBLISHED 的观测，草稿不计入；
 * - 首现日取每个阶段在每个日历年里 observationDate 最小的一条；
 * - 资料卡不落库快照，全部在读取时实时聚合，因此来源记录被删除或改期后，
 *   下次打开（含只读分享链接）看到的口径自动同步，无需额外维护。
 */

export const profileObservationInclude = observationInclude;

type ProfileRow = ObservationWithRelations;

export type SpeciesProfileParams = {
  ownerId: string;
  speciesId: string;
  /** 可选：只读分享链接固定在某个地点；登录用户也可用它收敛范围。 */
  siteId?: string;
};

function notFound(): ApiError {
  return new ApiError(404, "NOT_FOUND", "物种不存在");
}

type GalleryPhoto = {
  id: string;
  thumbUrl: string;
  displayUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  takenAt: Date | null;
  observationId: string;
  observationDate: string;
};

function galleryPhoto(photo: ProfileRow["photos"][number], observationDate: string): GalleryPhoto {
  return {
    id: photo.id,
    thumbUrl: storage.publicUrl(photo.thumbKey, "thumb"),
    displayUrl: storage.publicUrl(photo.displayKey, "display"),
    originalUrl: storage.publicUrl(photo.storageKey, "original"),
    width: photo.width,
    height: photo.height,
    takenAt: photo.takenAt,
    observationId: photo.observationId,
    observationDate,
  };
}

export type SpeciesProfile = {
  species: {
    id: string;
    commonName: string;
    scientificName: string | null;
    family: string | null;
    category: string;
    description: string | null;
  };
  /** 资料卡覆盖的地点（该物种在这些地点有已发布观测）。 */
  sites: Array<{ id: string; name: string }>;
  phenophases: Array<{ id: string; name: string; color: string; orderIndex: number }>;
  summary: {
    observationCount: number;
    photoCount: number;
    siteCount: number;
    yearCount: number;
    years: number[];
    firstObservationDate: string | null;
    lastObservationDate: string | null;
  };
  /** 不区分阶段的物种级历年首现日。 */
  overall: {
    items: Array<{
      year: number;
      onsetDate: string | null;
      dayOfYear: number | null;
      offsetText: string;
      observationId: string | null;
    }>;
    baseline: { method: "median"; yearsUsed: number[]; dayOfYear: number } | null;
    reason?: "INSUFFICIENT_HISTORY";
  };
  /** 按物候阶段拆分的历年首现日序列。 */
  phases: Array<{
    phenophase: { id: string | null; name: string; color: string };
    observationCount: number;
    items: Array<{
      year: number;
      onsetDate: string | null;
      dayOfYear: number | null;
      offsetVsPrevYear: number | null;
      offsetVsBaseline: number | null;
      offsetText: string;
      observationId: string | null;
    }>;
    baseline: { method: "median"; yearsUsed: number[]; dayOfYear: number } | null;
    reason?: "INSUFFICIENT_HISTORY";
  }>;
  photos: GalleryPhoto[];
  /** 最近的已发布观测（详情/时间线口径一致的序列化结果），供资料卡时间线展示。 */
  recentObservations: Array<ReturnType<typeof serializeObservation>>;
};

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** 每个日历年的首条（observationDate 最小，并列时取创建更早的）。 */
function firstPerYear(rows: ProfileRow[]): Map<number, ProfileRow> {
  const map = new Map<number, ProfileRow>();
  for (const row of rows) {
    const year = yearOf(row.observationDate);
    const existing = map.get(year);
    if (
      !existing ||
      row.observationDate < existing.observationDate ||
      (row.observationDate === existing.observationDate && row.createdAt < existing.createdAt)
    ) {
      map.set(year, row);
    }
  }
  return map;
}

export async function buildSpeciesProfile(params: SpeciesProfileParams): Promise<SpeciesProfile> {
  const speciesWhere: Prisma.SpeciesWhereInput = {
    id: params.speciesId,
    OR: [{ ownerId: params.ownerId }, { isPreset: true }],
  };
  const species = await prisma.species.findFirst({ where: speciesWhere });
  if (!species) throw notFound();

  const obsWhere: Prisma.ObservationWhereInput = {
    ownerId: params.ownerId,
    speciesId: params.speciesId,
    status: "PUBLISHED",
    ...(params.siteId ? { siteId: params.siteId } : {}),
  };

  const [rows, phenophaseRows] = await Promise.all([
    prisma.observation.findMany({
      where: obsWhere,
      include: profileObservationInclude,
      orderBy: [{ observationDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.phenophase.findMany({
      where: { speciesId: params.speciesId },
      orderBy: { orderIndex: "asc" },
    }),
  ]);

  // —— 地点 ——
  const siteMap = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    if (!siteMap.has(row.site.id)) siteMap.set(row.site.id, { id: row.site.id, name: row.site.name });
  }
  const sites = [...siteMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  // —— 物候阶段（含已定义但尚无观测的阶段；另为无阶段观测保留一个分组）——
  const definedPhases = phenophaseRows.map((phase) => ({
    id: phase.id,
    name: phase.name,
    color: phase.color,
    orderIndex: phase.orderIndex,
  }));

  // —— 照片墙：观测按日期倒序，同一观测内照片按 sortOrder ——
  const photos: GalleryPhoto[] = rows.flatMap((row) =>
    row.photos.map((photo) => galleryPhoto(photo, row.observationDate)),
  );

  // —— 年份 / 汇总 ——
  const years = [...new Set(rows.map((row) => yearOf(row.observationDate)))].sort((a, b) => a - b);

  // —— 物种级历年首现 ——
  const overallFirst = firstPerYear([...rows].reverse());
  const overallSeries = buildPhenologySeries(
    years.map((year) => ({ year, onsetDate: overallFirst.get(year)?.observationDate ?? null })),
  );

  // —— 分阶段历年首现 ——
  const groups = new Map<string, ProfileRow[]>();
  for (const row of rows) {
    const key = row.phenophaseId ?? "__NONE__";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const phaseEntries: SpeciesProfile["phases"] = [];

  const pushPhase = (
    meta: { id: string | null; name: string; color: string },
    phaseRows: ProfileRow[],
  ) => {
    const ascending = [...phaseRows].sort(
      (a, b) =>
        a.observationDate.localeCompare(b.observationDate) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const firstByYear = firstPerYear(ascending);
    const phaseYears = [...firstByYear.keys()].sort((a, b) => a - b);
    const series = buildPhenologySeries(
      phaseYears.map((year) => ({ year, onsetDate: firstByYear.get(year)?.observationDate ?? null })),
    );
    phaseEntries.push({
      phenophase: meta,
      observationCount: phaseRows.length,
      items: series.items.map((item) => ({
        year: item.year,
        onsetDate: item.onsetDate,
        dayOfYear: item.dayOfYear,
        offsetVsPrevYear: item.offsetVsPrevYear,
        offsetVsBaseline: item.offsetVsBaseline,
        offsetText: describeOffset(item.offsetVsBaseline ?? item.offsetVsPrevYear),
        observationId: firstByYear.get(item.year)?.id ?? null,
      })),
      baseline: series.baseline,
      ...(series.reason ? { reason: series.reason } : {}),
    });
  };

  for (const phase of definedPhases) {
    pushPhase({ id: phase.id, name: phase.name, color: phase.color }, groups.get(phase.id) ?? []);
  }
  if (groups.has("__NONE__")) {
    pushPhase(
      { id: null, name: "未标注阶段", color: "#9AA5B1" },
      groups.get("__NONE__") ?? [],
    );
  }

  return {
    species: {
      id: species.id,
      commonName: species.commonName,
      scientificName: species.scientificName,
      family: species.family,
      category: species.category,
      description: species.description,
    },
    sites,
    phenophases: definedPhases,
    summary: {
      observationCount: rows.length,
      photoCount: photos.length,
      siteCount: sites.length,
      yearCount: years.length,
      years,
      firstObservationDate: rows.length ? rows[rows.length - 1].observationDate : null,
      lastObservationDate: rows.length ? rows[0].observationDate : null,
    },
    overall: {
      items: overallSeries.items.map((item) => ({
        year: item.year,
        onsetDate: item.onsetDate,
        dayOfYear: item.dayOfYear,
        offsetText: describeOffset(item.offsetVsBaseline ?? item.offsetVsPrevYear),
        observationId: overallFirst.get(item.year)?.id ?? null,
      })),
      baseline: overallSeries.baseline,
      ...(overallSeries.reason ? { reason: overallSeries.reason } : {}),
    },
    phases: phaseEntries,
    photos,
    recentObservations: rows.slice(0, 20).map(serializeObservation),
  };
}

/** 登录态：物种属于本人或系统预置库（预置物种通常无观测，除非 ownerId 为空的特例）。 */
export async function getSpeciesProfile(userId: string, speciesId: string, siteId?: string) {
  return buildSpeciesProfile({ ownerId: userId, speciesId, siteId });
}

/** 只读分享：校验 token 并固定其范围（siteId，必要时 speciesId）。 */
export async function resolveSharedSpeciesProfile(token: string): Promise<{
  profile: SpeciesProfile;
  link: {
    token: string;
    scope: string;
    expiresAt: Date;
    site: { id: string; name: string };
  };
}> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { site: { select: { id: true, name: true } } },
  });

  if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }
  if (link.scope !== "SPECIES_PROFILE" || !link.speciesId) {
    // 该 token 是地点时间线分享，不能越权当作物种资料卡读取
    throw new ApiError(404, "NOT_FOUND", "分享链接不存在或已失效");
  }

  const profile = await buildSpeciesProfile({
    ownerId: link.ownerId,
    speciesId: link.speciesId,
    siteId: link.siteId,
  });

  await prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } });

  return {
    profile,
    link: { token: link.token, scope: link.scope, expiresAt: link.expiresAt, site: link.site },
  };
}
