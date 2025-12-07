import { RedisClient } from "../redis/client.ts";

export async function getNextRuns() {
  const due = Math.floor(Date.now() / 1000); // seconds
  return await RedisClient.zRangeByScore("next_run_at", 0, due);
}
