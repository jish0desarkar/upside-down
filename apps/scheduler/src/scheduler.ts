import { createClient } from "redis";
import { query } from "./db/client.ts";

const client = createClient();

client.on("error", (err) => console.log("Redis Client Error", err));

await client.connect();
