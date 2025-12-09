import { KafkaJS } from "@confluentinc/kafka-javascript";

export async function consume(topic: string[]) {
  // Graceful shutdown
  const consumer = new KafkaJS.Kafka().consumer({
    "bootstrap.servers": process.env.BOOTSTRAP_SERVERS,
    "security.protocol": "sasl_ssl",
    "sasl.mechanisms": process.env.SASL_MECHANISM,
    "sasl.username": process.env.SASL_USERNAME,
    "sasl.password": process.env.SASL_PASSWORD,
    "client.id": "ccloud-nodejs-client-4ae5f615-ffca-4124-b094-42f1a1d994ac",
    "auto.offset.reset": "latest",
    kafkaJS: {
      groupId: "probe-group-1",
      heartbeatInterval: 5000, // 5s
      autoCommit: true,
      autoCommitInterval: 1000, // 1s
    },
  });
  process.on("SIGTERM", disconenct);
  process.on("SIGINT", disconenct);

  // connect the consumer to the broker
  await consumer.connect();

  // subscribe to the topic
  await consumer.subscribe({ topics: topic });

  consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log(
        `Consumed message from topic ${topic}, partition ${partition}: key = ${message?.key?.toString()}, value = ${message?.value?.toString()}`
      );
    },
  });
}

function disconenct(consumer: KafkaJS.Consumer) {
  consumer.commitOffsets().finally(() => {
    consumer.disconnect();
  });
}
