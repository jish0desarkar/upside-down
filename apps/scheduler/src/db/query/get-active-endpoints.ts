import { query } from "../client.ts";

export async function getActiveEndpoints() {
  return await query(
    `SELECT EXTRACT(epoch from (NOW() + check_interval))::bigint AS next_run_at, endpoint 
    FROM configs WHERE is_active=true`
  );
}
