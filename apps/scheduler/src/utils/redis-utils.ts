import { getActiveEndpoints } from "../db/query/get-active-endpoints.ts";
import { RedisClient } from "../redis/client.ts";

export async function hydrateRedisSortedSet() {
  const rows = (await getActiveEndpoints()).rows;
  const res = await RedisClient.zAdd(
    "next_run_at",
    rows.map((r) => {
      return { score: r.next_run_at, value: r.endpoint };
    })
  );
  await RedisClient.set("key", "value");
}
