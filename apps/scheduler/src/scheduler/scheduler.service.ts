import { SchedulerStatus } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

import { OutboxPublisher } from "../events/outbox-publisher.js";
import { promoteDueJobs } from "../scheduling/delayed-job-scheduler.js";
import { promoteRecurringSchedules } from "../scheduling/recurring-schedule-service.js";
import type { SchedulerSettings } from "./scheduler.types.js";

export interface OutboxPublisherLike {
  connect(): Promise<void>;
  publishBatch(): Promise<number>;
  disconnect(): Promise<void>;
}

const defaultPublisher = new OutboxPublisher({ clientId: `outbox-${process.pid}` });

export class SchedulerService {
  private pollTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private publishTimer: NodeJS.Timeout | undefined;
  private polling = false;
  private acceptingTicks = true;
  private started = false;

  constructor(
    private readonly settings: SchedulerSettings,
    private readonly publisher: OutboxPublisherLike = defaultPublisher
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const now = new Date();
    await prisma.scheduler.upsert({
      where: { schedulerIdentifier: this.settings.schedulerId },
      update: {
        status: SchedulerStatus.ACTIVE,
        startedAt: now,
        stoppedAt: null,
        lastHeartbeatAt: now
      },
      create: {
        schedulerIdentifier: this.settings.schedulerId,
        status: SchedulerStatus.ACTIVE,
        startedAt: now,
        lastHeartbeatAt: now
      }
    });
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch((error) => {
        console.error({
          schedulerId: this.settings.schedulerId,
          event: "scheduler.heartbeat_error",
          error
        });
      });
    }, this.settings.heartbeatIntervalMs);

    try {
      await this.publisher.connect();
      await this.publisher.publishBatch();
      this.publishTimer = setInterval(() => {
        void this.publisher.publishBatch().catch((error) => {
          console.error({
            schedulerId: this.settings.schedulerId,
            event: "scheduler.outbox_publish_error",
            error
          });
        });
      }, this.settings.pollIntervalMs);
    } catch (error) {
      console.warn({
        schedulerId: this.settings.schedulerId,
        event: "scheduler.outbox_unavailable",
        error
      });
    }

    await this.tick();
    this.pollTimer = setInterval(() => void this.tick(), this.settings.pollIntervalMs);
    console.info({ schedulerId: this.settings.schedulerId, event: "scheduler.started" });
  }

  async tick(): Promise<void> {
    if (!this.acceptingTicks || this.polling) return;
    this.polling = true;
    try {
      const delayed = await promoteDueJobs(this.settings.batchSize);
      const recurring = await promoteRecurringSchedules(this.settings.batchSize);
      console.info({
        schedulerId: this.settings.schedulerId,
        delayed,
        recurring,
        event: "scheduler.tick"
      });
    } catch (error) {
      console.error({ schedulerId: this.settings.schedulerId, event: "scheduler.error", error });
    } finally {
      this.polling = false;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.acceptingTicks = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.publishTimer) clearInterval(this.publishTimer);
    await this.publisher.disconnect().catch((error) => {
      console.warn({
        schedulerId: this.settings.schedulerId,
        event: "scheduler.outbox_disconnect_error",
        error
      });
    });
    await prisma.scheduler.update({
      where: { schedulerIdentifier: this.settings.schedulerId },
      data: { status: SchedulerStatus.DRAINING }
    });
    console.info({ schedulerId: this.settings.schedulerId, event: "scheduler.draining" });
    const deadline = Date.now() + this.settings.shutdownTimeoutMs;
    while (this.polling && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await prisma.scheduler.update({
      where: { schedulerIdentifier: this.settings.schedulerId },
      data: { status: SchedulerStatus.STOPPED, stoppedAt: new Date() }
    });
    console.info({ schedulerId: this.settings.schedulerId, event: "scheduler.stopped" });
    this.started = false;
  }

  private async heartbeat(): Promise<void> {
    try {
      await prisma.scheduler.update({
        where: {
          schedulerIdentifier: this.settings.schedulerId
        },
        data: {
          lastHeartbeatAt: new Date(),
          status: SchedulerStatus.ACTIVE
        }
      });

      console.info({
        schedulerId: this.settings.schedulerId,
        event: "scheduler.heartbeat"
      });
    } catch (error) {
      console.error({
        schedulerId: this.settings.schedulerId,
        event: "scheduler.heartbeat_error",
        error
      });
    }
  }
}
