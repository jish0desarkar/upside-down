import { hydrateRedisSortedSet, syncToRedis } from "./utils/redis-utils.ts";
import { kafkaPub } from "./kafka/producer.ts";
import { configDotenv } from "dotenv";
import { getNextRuns } from "./utils/get-next-runs.ts";
import { setTimeout } from "node:timers/promises";

configDotenv();

console.log(await hydrateRedisSortedSet());

while (true) {
  const nextRuns = await getNextRuns();
  const payload = nextRuns.map((r) => ({ key: r, value: "200" }));
  if (nextRuns.length > 0) {
    await kafkaPub(payload);
    await syncToRedis(nextRuns);
  } else {
    console.log(await setTimeout(1000));
  }
}
