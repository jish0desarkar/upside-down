import { RedisClient } from "../redis/client.ts";
import { query } from "../db/client.ts";
import { activeEnpointQueryType } from "../db/query/get-active-endpoints.ts";

export async function syncRedis() {
  const lastSyncedAt = await RedisClient.get("lastSynedAt");
  let endpointsToBeSynced: Array<activeEnpointQueryType>;
  if (lastSyncedAt == null) {
    endpointsToBeSynced = (
      await query(
        "SELECT endpoint, is_active, check_interval, expected_status_code FROM configs"
      )
    ).rows;
  } else {
    endpointsToBeSynced = (
      await query(
        "SELECT endpoint, is_active, check_interval, expected_status_code FROM configs WHERE updated_at > $1",
        [lastSyncedAt]
      )
    ).rows;
  }
  endpointsToBeSynced.forEach((element) => {
    RedisClient.zAdd("next_run_at", {
      score: element.next_run_at,
      value: element.endpoint,
    });
  });
}
