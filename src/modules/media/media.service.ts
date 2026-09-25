import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaTaskStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadTaskDto } from './dto/upload-task.dto';
import { MEDIA_MODERATION_QUEUE, MediaJobData } from './queue/media-job.types';

export interface UploadTaskResult {
  taskId: string;
  status: MediaTaskStatus;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue(MEDIA_MODERATION_QUEUE)
    private readonly moderationQueue: Queue<MediaJobData>,
  ) {}

  async enqueueUploadTask(
    userId: string,
    dto: UploadTaskDto,
  ): Promise<UploadTaskResult> {
    const taskId = randomUUID();

    await this.prisma.mediaTask.create({
      data: {
        taskId,
        userId,
        videoUrl: dto.videoUrl,
        status: MediaTaskStatus.PENDING,
      },
    });

    const attempts = this.configService.get<number>(
      'mediaQueue.jobAttempts',
    ) as number;
    const backoffMs = this.configService.get<number>(
      'mediaQueue.backoffMs',
    ) as number;

    // The HTTP thread only enqueues — all compute-heavy work happens in the
    // isolated worker process (see src/worker.ts).
    await this.moderationQueue.add(
      'moderate-media',
      {
        taskId,
        userId,
        videoUrl: dto.videoUrl,
        simulateFailure: dto.simulateFailure,
      },
      {
        jobId: taskId,
        attempts,
        backoff: { type: 'exponential', delay: backoffMs },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return { taskId, status: MediaTaskStatus.PENDING };
  }

  async getTaskStatus(taskId: string) {
    const task = await this.prisma.mediaTask.findUnique({ where: { taskId } });
    if (!task) {
      throw new NotFoundException(`No media task with id ${taskId}`);
    }
    return task;
  }
}
