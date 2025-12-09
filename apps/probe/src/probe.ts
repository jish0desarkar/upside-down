import { consume } from "./kafka/consumer.ts";
import { configDotenv } from "dotenv";

configDotenv();

await consume(["monitoring.request"]);
