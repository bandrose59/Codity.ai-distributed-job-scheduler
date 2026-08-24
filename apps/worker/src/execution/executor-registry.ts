import type { Job } from "@prisma/client";
import nodemailer from "nodemailer";
import { env } from "@job-scheduler/config";

import type { ExecutionResult, ExecutorRegistry, JobExecutor } from "./job-executor.js";

class TestExecutor implements JobExecutor {
  async execute(job: Job): Promise<ExecutionResult> {
    const payload = isRecord(job.payload) ? job.payload : {};
    const mode = typeof payload.mode === "string" ? payload.mode : undefined;
    const delayMs = typeof payload.durationMs === "number" ? payload.durationMs : payload.delayMs;
    const duration = typeof delayMs === "number" && delayMs >= 0 ? delayMs : 0;
    if (duration > 0) await new Promise((resolve) => setTimeout(resolve, duration));
    if (mode === "FAIL_ONCE_THEN_SUCCEED" && job.attemptCount === 1) {
      const error = new Error("Test executor configured to fail once") as Error & { retryable?: boolean };
      error.retryable = true;
      throw error;
    }
    if (mode === "FAIL_RETRYABLE" || payload.behavior === "fail") {
      const error = new Error("Test executor retryable failure") as Error & { retryable?: boolean };
      error.retryable = true;
      throw error;
    }
    if (mode === "FAIL_NON_RETRYABLE") {
      const error = new Error("Test executor non-retryable failure") as Error & { retryable?: boolean };
      error.retryable = false;
      throw error;
    }
    const result: ExecutionResult = {
      output: { status: "success", message: "Test execution completed" },
      metadata: { executor: "test", mode: mode ?? "SUCCESS" }
    };
    if (typeof payload.stdout === "string") result.stdout = payload.stdout;
    return result;
  }
}

class EmailExecutor implements JobExecutor {
  async execute(job: Job): Promise<ExecutionResult> {
    const payload = isRecord(job.payload) ? job.payload : {};
    const to = typeof payload.to === "string" ? payload.to : "";
    const subject = typeof payload.subject === "string" ? payload.subject : "";
    const text = typeof payload.text === "string" ? payload.text : undefined;
    const html = typeof payload.html === "string" ? payload.html : undefined;
    if (!to || !subject || (!text && !html)) {
      const error = new Error("Email payload requires to, subject, and text or html") as Error & { retryable?: boolean };
      error.retryable = false;
      throw error;
    }
    if (!env.SMTP_HOST || !env.SMTP_FROM) {
      const error = new Error("SMTP_HOST and SMTP_FROM are required for email jobs") as Error & { retryable?: boolean };
      error.retryable = false;
      throw error;
    }
    const transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}) });
    const sent = await transporter.sendMail({ from: env.SMTP_FROM, to, subject, ...(text ? { text } : {}), ...(html ? { html } : {}) });
    return { output: { status: "success", message: "Email sent", metadata: { provider: "smtp", messageId: sent.messageId } }, metadata: { executor: "email", provider: "smtp" } };
  }
}

export class DefaultExecutorRegistry implements ExecutorRegistry {
  private readonly testExecutor = new TestExecutor();
  private readonly emailExecutor = new EmailExecutor();

  resolve(job: Job): JobExecutor {
    const payload = isRecord(job.payload) ? job.payload : {};
    return payload.executor === "email" ? this.emailExecutor : this.testExecutor;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
