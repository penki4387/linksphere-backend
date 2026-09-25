import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { envValidationSchema } from '../config/env.validation';
import { bullmqConnectionFactory } from '../config/bullmq.config';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModerationProcessor } from '../modules/media/media.processor';
import {
  MEDIA_MODERATION_DLQ,
  MEDIA_MODERATION_QUEUE,
} from '../modules/media/queue/media-job.types';

/**
 * Standalone application context bootstrapped by src/worker.ts. Deliberately
 * excludes HTTP concerns (no controllers, no Express) so the BullMQ consumer
 * runs as a fully isolated process from the API server.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: bullmqConnectionFactory,
    }),
    BullModule.registerQueue(
      { name: MEDIA_MODERATION_QUEUE },
      { name: MEDIA_MODERATION_DLQ },
    ),
    PrismaModule,
  ],
  providers: [MediaModerationProcessor],
})
export class WorkerModule {}
