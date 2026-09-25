import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';

@Module({
  imports: [AuthModule],
  controllers: [StreamsController],
  providers: [StreamsService, RateLimitGuard],
})
export class StreamsModule {}
