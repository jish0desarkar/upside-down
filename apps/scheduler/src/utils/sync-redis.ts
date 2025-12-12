import { RedisClient } from "../redis/client.ts";
import { query } from "../db/client.ts";
import { activeEnpointQueryType } from "../db/query/get-active-endpoints.ts";
import { hydrateRedisSortedSet } from "./redis-utils.ts";

export async function syncRedis() {
  const BATCH_SIZE = 10;
  const lastSyncedAt = await RedisClient.get("lastSyncedAt");

  if (!lastSyncedAt) {
    await hydrateRedisSortedSet();
    await RedisClient.set("lastSyncedAt", new Date().toISOString());
  }

  const endpointsToBeSynced = (
    await query(
      "SELECT endpoint, is_active, EXTRACT(epoch from (NOW() + check_interval))::bigint AS next_run_at, expected_status_code FROM configs WHERE updated_at > $1",
      [lastSyncedAt]
    )
  ).rows;

  const activeEndpointTobeSynced = endpointsToBeSynced.filter(
    (r) => r.is_active
  );
  const inactiveEndpointTobeDeleted = endpointsToBeSynced.filter(
    (r) => !r.is_active
  );

  const multi = RedisClient.multi();
  if (activeEndpointTobeSynced.length > 0) {
    console.log(activeEndpointTobeSynced);
    for (let i = 0; i < activeEndpointTobeSynced.length; i += BATCH_SIZE) {
      const endpointSlice = activeEndpointTobeSynced.slice(i, i + BATCH_SIZE);
      multi.zAdd(
        "next_run_at",
        endpointSlice.map((el) => {
          return {
            score: el.next_run_at,
            value: el.endpoint,
          };
        })
      );
    }
  }
  if (inactiveEndpointTobeDeleted.length > 0) {
    for (const e of inactiveEndpointTobeDeleted) {
      multi.zRem("next_run_at", e.endpoint);
    }
  }

  multi.set("lastSyncedAt", new Date().toISOString());
  await multi.exec();
}
