import { hydrateRedisSortedSet } from "./utils/redis-utils.ts";
import { kafkaPub } from "./kafka/producer.ts";
import { configDotenv } from "dotenv";

configDotenv();

console.log(await hydrateRedisSortedSet());

await kafkaPub([
  {
    key: "test",
    value: "test",
  },
]);
