import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as headers from "next/headers";
import { GET } from "@/app/api/hourly-war/route";
import { village, war } from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { timerClaimFixture } from "../../../setup/gameTimers";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("shrine war daily treasury preservation", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(war, village);
    stubCronAuth(() => null);
    spies.push(vi.spyOn(headers, "cookies").mockResolvedValue({} as never));
    spies.push(vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({
      ...timerClaimFixture(), isNewHour: true, prevTime: new Date(0), response: Response.json("Ready"),
    }));
    spies.push(vi.spyOn(gamesettings, "getGameSetting").mockResolvedValue({
      id: "daily-timer", name: "daily-war-decay", time: new Date("2026-10-24T12:00:00.000Z"), value: 0,
    }));
    spies.push(vi.spyOn(gamesettings, "updateGameSetting").mockResolvedValue(undefined as never));
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    resetServerModuleStubs();
    setSystemTime();
  });

  it.each([1, 5, 8])("does not drain either treasury after %s days of shrine war", async (days) => {
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "shrine-attacker", name: "Shrine attacker", kageId: "attacker-kage", tokens: 800_000 },
      { id: "shrine-defender", name: "Shrine defender", kageId: "defender-kage", tokens: 600_000 },
    ]);
    const startedAt = new Date(now.getTime() - days * 86_400_000);
    await db.insert(war).values({
      id: "shrine-war", attackerVillageId: "shrine-attacker", defenderVillageId: "shrine-defender",
      type: "SECTOR_WAR", status: "ACTIVE", sector: 105,
      startedAt, lastTokenReductionAt: startedAt, defenderShrineHp: 500, defenderShrineMaxHp: 500,
    });

    expect((await GET(new Request("http://localhost/api/hourly-war"))).status).toBe(200);
    const attacker = await db.query.village.findFirst({ where: eq(village.id, "shrine-attacker") });
    const defender = await db.query.village.findFirst({ where: eq(village.id, "shrine-defender") });
    expect(attacker?.tokens).toBe(800_000);
    expect(defender?.tokens).toBe(600_000);
    expect(await db.query.war.findFirst({ where: eq(war.id, "shrine-war") })).toMatchObject({
      status: "ACTIVE", lastTokenReductionAt: startedAt, defenderShrineHp: 500,
    });
  });
});
