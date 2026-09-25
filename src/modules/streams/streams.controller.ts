import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { StreamDto } from './dto/stream.dto';
import { StreamsService } from './streams.service';

@Controller('api/v1/streams')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Get('active')
  async getActive(): Promise<StreamDto[]> {
    return this.streamsService.getActiveStreams();
  }
}
