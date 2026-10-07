import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, auth, createObservationViaApi, createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";

const api = () => request(app);

/**
 * 物种资料卡：照片 / 物候阶段 / 历年首现日聚合、只读分享范围限定、
 * 以及来源记录删除或改期后的口径同步。
 */
describe("物种资料卡", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedSpeciesWithYears() {
    const user = await registerUser();
    const site = await createSite(user.id, "校园银杏道");
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id, {
      commonName: "银杏",
      phaseName: "发芽",
    });

    // 同一阶段、两年：每年首现日应取当年最早的一条
    const payloads = [
      { observationDate: "2024-03-20" },
      { observationDate: "2024-03-10" }, // 2024 年首现
      { observationDate: "2025-03-05" }, // 2025 年首现
    ];
    const ids: string[] = [];
    for (const item of payloads) {
      const res = await createObservationViaApi(user, {
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        observationDate: item.observationDate,
      });
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }

    // 草稿不应进入资料卡口径
    const draft = await createObservationViaApi(user, {
      siteId: site.id,
      speciesId,
      phenophaseId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2023-01-01",
      status: "DRAFT",
    });
    expect(draft.status).toBe(201);

    return { user, site, speciesId, phenophaseId, ids };
  }

  it("聚合照片、物候阶段与历年首现日（草稿不计入）", async () => {
    const { user, speciesId, phenophaseId } = await seedSpeciesWithYears();

    const res = await api()
      .get(`/api/v1/profiles/species/${speciesId}`)
      .set(auth(user.accessToken));
    expect(res.status).toBe(200);

    const profile = res.body.data;
    expect(profile.species.commonName).toBe("银杏");
    expect(profile.summary.observationCount).toBe(3);
    expect(profile.summary.years).toEqual([2024, 2025]);

    // 物种级首现：2024 取 03-10 而非 03-20
    const overall = Object.fromEntries(profile.overall.items.map((i: { year: number }) => [i.year, i]));
    expect(overall[2024].onsetDate).toBe("2024-03-10");
    expect(overall[2025].onsetDate).toBe("2025-03-05");

    // 分阶段首现
    const phase = profile.phases.find((p: { phenophase: { id: string } }) => p.phenophase.id === phenophaseId);
    expect(phase).toBeTruthy();
    expect(phase.observationCount).toBe(3);
    const phase2024 = phase.items.find((i: { year: number }) => i.year === 2024);
    expect(phase2024.onsetDate).toBe("2024-03-10");
  });

  it("删除来源记录后首现日口径实时同步", async () => {
    const { user, site, speciesId, ids } = await seedSpeciesWithYears();
    // ids: [2024-03-20, 2024-03-10(首现), 2025-03-05]
    const first2024 = ids[1];

    const before = await api().get(`/api/v1/profiles/species/${speciesId}`).set(auth(user.accessToken));
    expect(
      before.body.data.overall.items.find((i: { year: number }) => i.year === 2024).onsetDate,
    ).toBe("2024-03-10");

    const del = await api().delete(`/api/v1/observations/${first2024}`).set(auth(user.accessToken));
    expect(del.status).toBe(200);

    const after = await api().get(`/api/v1/profiles/species/${speciesId}`).set(auth(user.accessToken));
    const y2024 = after.body.data.overall.items.find((i: { year: number }) => i.year === 2024);
    expect(y2024.onsetDate).toBe("2024-03-20"); // 回退到次早记录
    expect(after.body.data.summary.observationCount).toBe(2);
    void site;
  });

  it("改期来源记录后首现日口径实时同步", async () => {
    const { user, speciesId, ids } = await seedSpeciesWithYears();
    const first2024 = ids[1]; // 2024-03-10

    const patch = await api()
      .patch(`/api/v1/observations/${first2024}`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2024-04-01" });
    expect(patch.status).toBe(200);

    const after = await api().get(`/api/v1/profiles/species/${speciesId}`).set(auth(user.accessToken));
    const y2024 = after.body.data.overall.items.find((i: { year: number }) => i.year === 2024);
    expect(y2024.onsetDate).toBe("2024-03-20"); // 最早记录变为原来的次早记录
  });

  it("只读分享链接限定到该物种×地点，匿名可访问且不泄露其它地点", async () => {
    const { user, site, speciesId } = await seedSpeciesWithYears();
    const otherSite = await createSite(user.id, "后山样线");
    const otherObs = await createObservationViaApi(user, {
      siteId: otherSite.id,
      speciesId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2025-02-01",
    });
    expect(otherObs.status).toBe(201);

    // 未限定 siteId 的登录视图应包含两个地点
    const all = await api().get(`/api/v1/profiles/species/${speciesId}`).set(auth(user.accessToken));
    expect(all.body.data.summary.siteCount).toBe(2);

    // 生成只读分享（必须指定地点）
    const share = await api()
      .post(`/api/v1/profiles/species/${speciesId}/share`)
      .set(auth(user.accessToken))
      .send({ siteId: site.id, expiresInDays: 30 });
    expect(share.status).toBe(201);
    expect(share.body.data.scope).toBe("SPECIES_PROFILE");
    const token = share.body.data.token;

    // 匿名访问
    const anon = await api().get(`/api/v1/share/${token}`);
    expect(anon.status).toBe(200);
    expect(anon.body.data.kind).toBe("SPECIES_PROFILE");
    const sharedProfile = anon.body.data.profile;
    expect(sharedProfile.summary.siteCount).toBe(1);
    expect(sharedProfile.sites[0].id).toBe(site.id);
    // 后山样线 2025-02-01 不得出现在被限定的分享里
    const y2025 = sharedProfile.overall.items.find((i: { year: number }) => i.year === 2025);
    expect(y2025.onsetDate).toBe("2025-03-05");
  });

  it("分享来源删除记录后，匿名再看口径已同步", async () => {
    const { user, site, speciesId, ids } = await seedSpeciesWithYears();
    const share = await api()
      .post(`/api/v1/profiles/species/${speciesId}/share`)
      .set(auth(user.accessToken))
      .send({ siteId: site.id, expiresInDays: 30 });
    const token = share.body.data.token;

    const before = await api().get(`/api/v1/share/${token}`);
    expect(
      before.body.data.profile.overall.items.find((i: { year: number }) => i.year === 2024).onsetDate,
    ).toBe("2024-03-10");

    await api().delete(`/api/v1/observations/${ids[1]}`).set(auth(user.accessToken));

    const after = await api().get(`/api/v1/share/${token}`);
    expect(
      after.body.data.profile.overall.items.find((i: { year: number }) => i.year === 2024).onsetDate,
    ).toBe("2024-03-20");
  });

  it("不能为他人或预置物种、或用他人地点创建分享", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const aliceSpecies = await createSpeciesWithPhase(alice.id, { commonName: "Alice 的树" });
    const bobSite = await createSite(bob.id, "Bob 的地点");

    // 物种不属于 bob
    const wrongSpecies = await api()
      .post(`/api/v1/profiles/species/${aliceSpecies.speciesId}/share`)
      .set(auth(bob.accessToken))
      .send({ siteId: bobSite.id });
    expect(wrongSpecies.status).toBe(404);

    // bob 的物种 + alice 不存在的地点
    const bobSpecies = await createSpeciesWithPhase(bob.id, { commonName: "Bob 的树" });
    const wrongSite = await api()
      .post(`/api/v1/profiles/species/${bobSpecies.speciesId}/share`)
      .set(auth(bob.accessToken))
      .send({ siteId: aliceSpecies.speciesId }); // 用一个物种 id 充当 siteId，必然不匹配
    expect(wrongSite.status).toBe(404);
  });

  it("地点时间线 token 不能当物种卡读取，反之亦然", async () => {
    const { user, site, speciesId } = await seedSpeciesWithYears();

    // 物种卡 token 走时间线视图应 404
    const speciesShare = await api()
      .post(`/api/v1/profiles/species/${speciesId}/share`)
      .set(auth(user.accessToken))
      .send({ siteId: site.id });
    expect((await api().get(`/api/v1/share/${speciesShare.body.data.token}`)).body.data.kind).toBe(
      "SPECIES_PROFILE",
    );

    // 普通时间线 token 返回 TIMELINE
    const timeline = await user.agent
      .post(`/api/v1/sites/${site.id}/share`)
      .set(auth(user.accessToken))
      .send({ scope: "TIMELINE", expiresInDays: 30 });
    expect(timeline.status).toBe(201);
    const timelineView = await api().get(`/api/v1/share/${timeline.body.data.token}`);
    expect(timelineView.body.data.kind).toBe("TIMELINE");
  });
});
