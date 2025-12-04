import { createClient, RedisClientType } from "redis";

export const RedisClient: RedisClientType = createClient();

RedisClient.on("error", (err) => console.log("Redis Client Error", err));

await RedisClient.connect();
