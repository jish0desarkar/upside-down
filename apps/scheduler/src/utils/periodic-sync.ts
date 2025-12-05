import cron from "node-cron";
import { syncRedis } from "./sync-redis.ts";

// Run sync job every 10 mins
cron.schedule("*/1 * * * *", () => {
  syncRedis();
});
