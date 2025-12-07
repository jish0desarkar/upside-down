import { query } from "../db/client.ts";
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
  return res;
}

export async function syncToRedis(params: Array<string>) {
  const row = (
    await query(
      `SELECT endpoint, EXTRACT(epoch from (NOW() + check_interval))::bigint AS next_run_at
      FROM configs WHERE endpoint = ANY ($1)`,
      [params]
    )
  ).rows;
  if (row.length > 0) {
    const multi = RedisClient.multi();
    multi.zRem("next_run_at", params);
    multi.zAdd(
      "next_run_at",
      row.map((r) => {
        return {
          score: r.next_run_at,
          value: r.endpoint,
        };
      })
    );
    await multi.exec();
  }
}
