import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MediaTaskStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MEDIA_MODERATION_DLQ,
  MEDIA_MODERATION_QUEUE,
  MediaJobData,
} from './queue/media-job.types';

const randomBetween = (minMs: number, maxMs: number): number =>
  Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Simulated background transcoding/keyframe-analysis workflow. Runs only
 * inside the isolated worker process (src/worker.ts) — never on the HTTP
 * request-response thread.
 */
@Processor(MEDIA_MODERATION_QUEUE, { concurrency: 5 })
export class MediaModerationProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaModerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MEDIA_MODERATION_DLQ)
    private readonly deadLetterQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<MediaJobData>): Promise<{ status: MediaTaskStatus }> {
    const { taskId, simulateFailure } = job.data;
    this.logger.log(
      `Processing task ${taskId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
    );

    await this.prisma.mediaTask.update({
      where: { taskId },
      data: { status: MediaTaskStatus.PROCESSING, attempts: { increment: 1 } },
    });

    // Simulate realistic FFmpeg / keyframe-analysis processing latency.
    await sleep(randomBetween(500, 2000));

    if (simulateFailure) {
      throw new Error(
        'Simulated persistent moderation failure (forced by simulateFailure)',
      );
    }
    if (Math.random() < 0.15) {
      throw new Error(
        'Simulated transient moderation failure (keyframe decode error)',
      );
    }

    await this.prisma.mediaTask.update({
      where: { taskId },
      data: { status: MediaTaskStatus.COMPLETED },
    });

    return { status: MediaTaskStatus.COMPLETED };
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<MediaJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;

    this.logger.warn(
      `Task ${job.data.taskId} failed attempt ${job.attemptsMade}/${maxAttempts}: ${err.message}`,
    );

    if (!exhausted) {
      return; // BullMQ will retry with the configured exponential backoff.
    }

    await this.prisma.mediaTask.update({
      where: { taskId: job.data.taskId },
      data: {
        status: MediaTaskStatus.FAILED_MODERATION,
        failReason: err.message,
      },
    });

    await this.deadLetterQueue.add('dead-letter', {
      ...job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });

    this.logger.error(`Task ${job.data.taskId} moved to dead-letter queue`);
  }
}
