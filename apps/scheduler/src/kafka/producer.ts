import { KafkaJS } from "@confluentinc/kafka-javascript";
import { Message } from "@confluentinc/kafka-javascript/types/kafkajs.js";
import { configDotenv } from "dotenv";
configDotenv();

const producer = new KafkaJS.Kafka().producer({
  "bootstrap.servers": process.env.BOOTSTRAP_SERVERS,
  "security.protocol": "sasl_ssl",
  "sasl.mechanisms": process.env.SASL_MECHANISM,
  "sasl.username": process.env.SASL_USERNAME,
  "sasl.password": process.env.SASL_PASSWORD,
  "client.id": "ccloud-nodejs-client-4ae5f615-ffca-4124-b094-42f1a1d994ac",
});

export async function kafkaPub(payload: Array<Message>) {
  await producer.connect();
  await producer.send({
    topic: "monitoring.request",
    messages: payload,
  });
  await producer.disconnect();
}
