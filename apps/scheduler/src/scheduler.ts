import { hydrateRedisSortedSet, syncToRedis } from "./utils/redis-utils.ts";
import { kafkaPub } from "./kafka/producer.ts";
import { configDotenv } from "dotenv";
import { getNextRuns } from "./utils/get-next-runs.ts";

configDotenv();

console.log(await hydrateRedisSortedSet());

while (true) {
  const nextRuns = await getNextRuns();
  const payload = nextRuns.map((r) => ({ key: r, value: "200" }));
  await kafkaPub(payload);
  await syncToRedis(nextRuns);
}
