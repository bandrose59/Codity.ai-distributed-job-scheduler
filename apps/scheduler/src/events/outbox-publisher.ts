import { Kafka, type Producer } from "kafkajs";
import { Prisma } from "@prisma/client";

import { prisma } from "@job-scheduler/database";
import { env } from "@job-scheduler/config";

export interface OutboxPublisherOptions {
  batchSize?: number;
  brokers?: string[];
  clientId?: string;
}

export class OutboxPublisher {
  private readonly kafka: Kafka;
  private producer: Producer | undefined;
  private readonly batchSize: number;
  private readonly publisherId: string;

  constructor(options: OutboxPublisherOptions = {}) {
    this.publisherId = options.clientId ?? `outbox-${process.pid}`;
    this.kafka = new Kafka({ clientId: this.publisherId, brokers: options.brokers ?? env.KAFKA_BROKERS.split(",") });
    this.batchSize = options.batchSize ?? 100;
  }

  async connect(): Promise<void> {
    this.producer = this.kafka.producer();
    await this.producer.connect();
  }

  async publishBatch(): Promise<number> {
    const events = await prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; event_type: string; payload: Prisma.JsonValue }>>(Prisma.sql`
        SELECT id, event_type, payload
        FROM outbox_events
        WHERE published_at IS NULL
          AND (reserved_at IS NULL OR reserved_at < NOW() - INTERVAL '1 minute')
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.batchSize}
      `);
      for (const row of rows) {
        await transaction.outboxEvent.update({ where: { id: row.id }, data: { reservedAt: new Date(), reservedBy: this.publisherId, attempts: { increment: 1 } } });
      }
      return rows;
    });
    if (!this.producer || events.length === 0) return 0;
    for (const event of events) {
      try {
        await this.producer.send({ topic: topicFor(event.event_type), messages: [{ key: event.id, value: JSON.stringify(event.payload) }] });
        await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date(), reservedAt: null, reservedBy: null, lastError: null } });
        console.info({ eventId: event.id, event: "outbox.published" });
      } catch (error) {
        await prisma.outboxEvent.update({ where: { id: event.id }, data: { reservedAt: null, reservedBy: null, lastError: error instanceof Error ? error.message : "publish failed" } });
        console.error({ eventId: event.id, event: "outbox.publish_failed" });
      }
    }
    return events.length;
  }

  async disconnect(): Promise<void> {
    await this.producer?.disconnect();
  }
}

function topicFor(eventType: string): string {
  if (eventType === "JOB_RETRY") return "jobs.retry";
  if (eventType === "JOB_DLQ") return "jobs.dlq";
  return "jobs.ready";
}
