import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import {
  app,
  auth,
  createObservationViaApi,
  createSite,
  createSpeciesWithPhase,
  makeJpeg,
  registerUser,
  resetDatabase,
  type RegisteredUser,
} from "./helpers/db";
import request from "supertest";

async function setupSpeciesWithYears(user: RegisteredUser) {
  const siteA = await createSite(user.id, "甲观察点");
  const siteB = await createSite(user.id, "乙观察点");
  const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id, { commonName: "卡片银杏" });

  // 2024：03-18 发芽（晚于另一条，用于验证首现取最早）+ 03-10 无阶段记录
  await createObservationViaApi(user, {
    siteId: siteA.id,
    speciesId,
    phenophaseId,
    kind: "PLANT_PHENOLOGY",
    observationDate: "2024-03-18",
  });
  await createObservationViaApi(user, {
    siteId: siteA.id,
    speciesId,
    kind: "PLANT_PHENOLOGY",
    observationDate: "2024-03-10",
    allowDuplicate: true,
  });
  // 2025：03-12 发芽，且在乙观察点
  const obs2025 = await createObservationViaApi(user, {
    siteId: siteB.id,
    speciesId,
    phenophaseId,
    kind: "PLANT_PHENOLOGY",
    observationDate: "2025-03-12",
  });
  // 草稿永远不进卡片
  await createObservationViaApi(user, {
    siteId: siteA.id,
    speciesId,
    phenophaseId,
    kind: "PLANT_PHENOLOGY",
    observationDate: "2025-01-05",
    status: "DRAFT",
  });

  return { siteA, siteB, speciesId, phenophaseId, obs2025Id: obs2025.body.data.id as string };
}

describe("物种资料卡", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("聚合物候阶段、历年首现日与照片，且草稿不出现", async () => {
    const user = await registerUser();
    const { speciesId, phenophaseId, obs2025Id } = await setupSpeciesWithYears(user);

    const jpeg = await makeJpeg(400, 300);
    await user.agent
      .post(`/api/v1/observations/${obs2025Id}/photos`)
      .set(auth(user.accessToken))
      .attach("files", jpeg, "bud.jpg")
      .expect(201);

    const response = await user.agent.get(`/api/v1/species/${speciesId}/card`).set(auth(user.accessToken));
    expect(response.status).toBe(200);
    const card = response.body.data;

    expect(card.kind).toBe("SPECIES_CARD");
    expect(card.species.commonName).toBe("卡片银杏");
    expect(card.stats.observationCount).toBe(3);
    expect(card.stats.photoCount).toBe(1);
    expect(card.stats.siteCount).toBe(2);
    expect(card.stats.yearCount).toBe(2);
    expect(card.stats.firstObservationDate).toBe("2024-03-10");
    expect(card.stats.lastObservationDate).toBe("2025-03-12");
    expect(card.revision).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const phase = card.phenophases.find((item: { id: string }) => item.id === phenophaseId);
    expect(phase.observationCount).toBe(2);
    expect(phase.firstSeen.date).toBe("2024-03-18");
    expect(phase.years).toEqual([2024, 2025]);

    expect(card.firstAppearances).toHaveLength(2);
    expect(card.firstAppearances[0]).toMatchObject({
      year: 2024,
      firstDate: "2024-03-10",
      observationId: expect.any(String),
    });
    expect(card.firstAppearances[1]).toMatchObject({ year: 2025, firstDate: "2025-03-12" });

    expect(card.photos).toHaveLength(1);
    expect(card.photos[0]).toMatchObject({
      observationDate: "2025-03-12",
      siteName: "乙观察点",
      originalUrl: expect.stringContaining("/files/original/"),
    });
  });

  it("本人卡片可按地点限定范围", async () => {
    const user = await registerUser();
    const { speciesId, siteB } = await setupSpeciesWithYears(user);

    const response = await user.agent
      .get(`/api/v1/species/${speciesId}/card?siteId=${siteB.id}`)
      .set(auth(user.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.data.stats.observationCount).toBe(1);
    expect(response.body.data.stats.siteCount).toBe(1);
    expect(response.body.data.firstAppearances[0]).toMatchObject({ year: 2025, firstDate: "2025-03-12" });
  });

  it("不能读取他人物种的卡片", async () => {
    const owner = await registerUser();
    const { speciesId } = await setupSpeciesWithYears(owner);
    const other = await registerUser();

    const response = await other.agent.get(`/api/v1/species/${speciesId}/card`).set(auth(other.accessToken));
    expect(response.status).toBe(404);
  });

  it("来源记录删除或改期后，卡片口径与 revision 立即同步", async () => {
    const user = await registerUser();
    const { speciesId, obs2025Id } = await setupSpeciesWithYears(user);

    const first = await user.agent.get(`/api/v1/species/${speciesId}/card`).set(auth(user.accessToken));
    expect(first.body.data.firstAppearances[1]).toMatchObject({ year: 2025, firstDate: "2025-03-12" });
    const revisionBefore = first.body.data.revision;

    // 改期：2025-03-12 → 2025-03-08，首现日跟随变化
    await user.agent
      .patch(`/api/v1/observations/${obs2025Id}`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2025-03-08" })
      .expect(200);

    const afterDateChange = await user.agent
      .get(`/api/v1/species/${speciesId}/card`)
      .set(auth(user.accessToken));
    expect(afterDateChange.body.data.firstAppearances[1].firstDate).toBe("2025-03-08");
    expect(afterDateChange.body.data.revision).not.toBe(revisionBefore);

    // 删除 2024 年全部记录：2024 年从首现序列消失
    const list2024 = await prisma.observation.findMany({
      where: { observationDate: { startsWith: "2024" } },
      select: { id: true },
    });
    for (const row of list2024) {
      await user.agent.delete(`/api/v1/observations/${row.id}`).set(auth(user.accessToken)).expect(200);
    }

    const afterDelete = await user.agent.get(`/api/v1/species/${speciesId}/card`).set(auth(user.accessToken));
    expect(afterDelete.body.data.firstAppearances.map((item: { year: number }) => item.year)).toEqual([2025]);
    expect(afterDelete.body.data.stats.observationCount).toBe(1);
  });
});

describe("物种资料卡只读分享", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("匿名 token 仅返回限定物种与地点的只读卡片，且不带观测 id / 原图地址", async () => {
    const user = await registerUser();
    const { speciesId, siteB, obs2025Id } = await setupSpeciesWithYears(user);

    const jpeg = await makeJpeg(320, 240);
    await user.agent
      .post(`/api/v1/observations/${obs2025Id}/photos`)
      .set(auth(user.accessToken))
      .attach("files", jpeg, "bud.jpg")
      .expect(201);

    const created = await user.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(user.accessToken))
      .send({ scope: "SPECIES_CARD", siteId: siteB.id, expiresInDays: 7 })
      .expect(201);
    const token = created.body.data.token;
    expect(created.body.data.url).toContain(`/species-share/${token}`);

    const anon = await request(app).get(`/api/v1/species-share/${token}`);
    expect(anon.status).toBe(200);
    const { card, share } = anon.body.data;
    expect(share.scope).toBe("SPECIES_CARD");
    expect(card.scope).toMatchObject({ siteId: siteB.id, siteName: "乙观察点" });
    expect(card.stats.observationCount).toBe(1);
    expect(card.firstAppearances[0].observationId).toBeNull();
    expect(card.photos[0]).not.toHaveProperty("originalUrl");
    expect(anon.body.data.owner).toEqual({ displayName: "测试观察者" });
  });

  it("不带 siteId 的链接覆盖该物种全部地点，但仍不暴露其他物种", async () => {
    const user = await registerUser();
    const { speciesId } = await setupSpeciesWithYears(user);

    const created = await user.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(user.accessToken))
      .send({ scope: "SPECIES_CARD", expiresInDays: 30 });
    const token = created.body.data.token;

    const anon = await request(app).get(`/api/v1/species-share/${token}`);
    expect(anon.status).toBe(200);
    expect(anon.body.data.card.stats.observationCount).toBe(3);
    expect(anon.body.data.card.stats.siteCount).toBe(2);
  });

  it("删除来源记录后，旧链接内容同步更新（revision 校验）", async () => {
    const user = await registerUser();
    const { speciesId, obs2025Id } = await setupSpeciesWithYears(user);
    const created = await user.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(user.accessToken))
      .send({ scope: "SPECIES_CARD" });
    const token = created.body.data.token;

    const first = await request(app).get(`/api/v1/species-share/${token}`);
    const revision = first.body.data.card.revision;
    expect(first.body.data.card.stats.observationCount).toBe(3);

    // 带 revision 轮询：未变化时 unchanged=true
    const pollSame = await request(app).get(`/api/v1/species-share/${token}?revision=${revision}`);
    expect(pollSame.body.data.share.unchanged).toBe(true);

    await user.agent.delete(`/api/v1/observations/${obs2025Id}`).set(auth(user.accessToken));
    const second = await request(app).get(`/api/v1/species-share/${token}?revision=${revision}`);
    expect(second.body.data.card.stats.observationCount).toBe(2);
    expect(second.body.data.share.unchanged).toBe(false);
    expect(second.body.data.card.revision).not.toBe(revision);
  });

  it("过期与撤销的链接均返回 404", async () => {
    const user = await registerUser();
    const { speciesId } = await setupSpeciesWithYears(user);
    const created = await user.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(user.accessToken))
      .send({ scope: "SPECIES_CARD" });
    const { token, id } = created.body.data;

    await prisma.shareLink.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/v1/species-share/${token}`)).status).toBe(404);

    await prisma.shareLink.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 10000), revokedAt: new Date() } });
    expect((await request(app).get(`/api/v1/species-share/${token}`)).status).toBe(404);
  });

  it("物种卡 token 不能用于地点时间线分享入口，反之亦然", async () => {
    const user = await registerUser();
    const { speciesId } = await setupSpeciesWithYears(user);
    const cardLink = await user.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(user.accessToken))
      .send({ scope: "SPECIES_CARD" });

    // 地点时间线入口收到物种卡 token → 404
    const viaTimeline = await request(app).get(`/api/v1/share/${cardLink.body.data.token}`);
    expect(viaTimeline.status).toBe(404);

    // 物种卡入口收到地点 token → 404
    const site = await createSite(user.id, "地点分享用");
    const timelineLink = await user.agent
      .post(`/api/v1/sites/${site.id}/share`)
      .set(auth(user.accessToken))
      .send({ scope: "TIMELINE", expiresInDays: 7 });
    const viaCard = await request(app).get(`/api/v1/species-share/${timelineLink.body.data.token}`);
    expect(viaCard.status).toBe(404);
  });

  it("创建链接时若指定他人地点会被拒绝；链接可列出并撤销", async () => {
    const owner = await registerUser();
    const { speciesId } = await setupSpeciesWithYears(owner);
    const intruder = await registerUser();
    const othersSite = await createSite(intruder.id, "别人的点");

    const response = await owner.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(owner.accessToken))
      .send({ scope: "SPECIES_CARD", siteId: othersSite.id });
    expect(response.status).toBe(404);

    const created = await owner.agent
      .post(`/api/v1/species/${speciesId}/card/share`)
      .set(auth(owner.accessToken))
      .send({ scope: "SPECIES_CARD", expiresInDays: 7 });
    const linkId = created.body.data.id;

    const list = await owner.agent
      .get(`/api/v1/species/${speciesId}/card/share-links`)
      .set(auth(owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].revokedAt).toBeNull();

    await owner.agent
      .delete(`/api/v1/species/${speciesId}/card/share-links/${linkId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect((await request(app).get(`/api/v1/species-share/${created.body.data.token}`)).status).toBe(404);
  });
});
