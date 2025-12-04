import { QueryResult } from "pg";
import { query } from "../client.ts";

type activeEnpointQueryType = {
  next_run_at: number;
  endpoint: string;
};

export async function getActiveEndpoints(): Promise<
  QueryResult<activeEnpointQueryType>
> {
  return await query(
    `SELECT EXTRACT(epoch from (NOW() + check_interval))::bigint AS next_run_at, endpoint 
    FROM configs WHERE is_active=true`
  );
}
