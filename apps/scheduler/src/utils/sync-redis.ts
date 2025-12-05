import { RedisClient } from "../redis/client.ts";
import { query } from "../db/client.ts";
import { activeEnpointQueryType } from "../db/query/get-active-endpoints.ts";

export async function syncRedis() {
  const BATCH_SIZE = 10;
  const lastSyncedAt = await RedisClient.get("lastSynedAt");
  let endpointsToBeSynced: Array<activeEnpointQueryType>;
  if (lastSyncedAt == null) {
    endpointsToBeSynced = (
      await query(
        "SELECT endpoint, is_active, EXTRACT(epoch from (NOW() + check_interval))::bigint AS next_run_at, expected_status_code FROM configs"
      )
    ).rows;
  } else {
    endpointsToBeSynced = (
      await query(
        "SELECT endpoint, is_active, EXTRACT(epoch from (NOW() + check_interval))::bigint AS next_run_at, expected_status_code FROM configs WHERE updated_at > $1",
        [lastSyncedAt]
      )
    ).rows;
  }
  for (let i = 0; i < endpointsToBeSynced.length; i += BATCH_SIZE) {
    const endpointSlice = endpointsToBeSynced.slice(i, i + BATCH_SIZE);
    await RedisClient.zAdd(
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
