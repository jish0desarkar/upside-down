import { KafkaJS } from "@confluentinc/kafka-javascript";
import { measureOnce } from "../check-endpoint.ts";
import { kafkaPub } from "./producer.ts";
import { Semaphore } from "../semaphore.ts";

export async function consume(topic: string[]) {
  // Graceful shutdown
  const consumer = new KafkaJS.Kafka().consumer({
    "bootstrap.servers": process.env.BOOTSTRAP_SERVERS,
    "security.protocol": "sasl_ssl",
    "sasl.mechanisms": process.env.SASL_MECHANISM,
    "sasl.username": process.env.SASL_USERNAME,
    "sasl.password": process.env.SASL_PASSWORD,
    "client.id": "ccloud-nodejs-client-4ae5f615-ffca-4124-b094-42f1a1d994ac",
    "auto.offset.reset": "largest",
    "group.id": "probe-group-1",
    "heartbeat.interval.ms": 5000,
    "enable.auto.commit": false,
  });
  process.on("SIGTERM", disconenct);
  process.on("SIGINT", disconenct);

  // connect the consumer to the broker
  await consumer.connect();

  // subscribe to the topic
  await consumer.subscribe({ topics: topic });

  // 100 concurrent requests
  const sem = new Semaphore(100);
  consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log(
        `Consumed message from topic ${topic}, partition ${partition}: key = ${message?.key?.toString()}, value = ${message?.value?.toString()}`
      );
      await sem.acquire();
      (async () => {
        try {
          const response = await measureOnce({
            url: message?.key?.toString() as string,
          });
          await kafkaPub([
            {
              key: response.url,
              value: JSON.stringify({
                event_time: response.timestamp,
                probe_id: "default",
                region: "local",
                status_code: response.status,
                success: response.ok,
                latency_ms: response.duration_ms,
                error_type: response.error,
                error_message: response.rawError,
                endpoint_id: message?.key?.toString(),
              }),
            },
          ]);
          console.log("COMMITTING OFFSET", message.offset);
          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: (BigInt(message.offset) + 1n).toString(),
            },
          ]);
        } catch (e) {
          console.error(e);
        } finally {
          sem.release();
        }
      })();
    },
  });
}

function disconenct(consumer: KafkaJS.Consumer) {
  consumer.commitOffsets();
}
