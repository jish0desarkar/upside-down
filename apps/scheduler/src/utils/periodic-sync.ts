import cron from "node-cron";
import { syncRedis } from "./sync-redis.ts";

// Run sync job every 1 mins
cron.schedule("*/1 * * * *", () => {
  syncRedis();
});
