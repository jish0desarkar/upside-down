import { RedisClient } from "../redis/client.ts";

export async function getNextRuns() {
  const due = Date.now();

  return await RedisClient.zRangeByScore("next_run_at", 0, due);
}
