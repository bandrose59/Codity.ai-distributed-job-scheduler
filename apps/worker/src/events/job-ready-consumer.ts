import { Kafka, type Consumer } from "kafkajs";

import { env } from "@job-scheduler/config";

import { WorkerService } from "../worker/worker.service.js";

export interface JobReadyEvent {
  eventType: "JOB_READY";
  eventId?: string;
  jobId: string;
  queueId: string;
  createdAt: string;
}

export class JobReadyConsumer {
  private readonly consumer: Consumer;

  constructor(
    private readonly worker: WorkerService,
    workerId: string,
    brokers = env.KAFKA_BROKERS.split(",")
  ) {
    const kafka = new Kafka({ clientId: `worker-${workerId}`, brokers });
    this.consumer = kafka.consumer({ groupId: "distributed-job-workers", sessionTimeout: 30_000 });
  }

  async connect(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: "jobs.ready", fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString()) as JobReadyEvent;
        console.info({
          eventId: event.eventId,
          jobId: event.jobId,
          queueId: event.queueId,
          event: "kafka.event_consumed"
        });
        await this.worker.processReadyJob(event.jobId, event.queueId);
      }
    });
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }
}
