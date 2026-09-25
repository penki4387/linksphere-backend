import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MEDIA_MODERATION_QUEUE } from './queue/media-job.types';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: MEDIA_MODERATION_QUEUE }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
