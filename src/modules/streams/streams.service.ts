import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StreamDto } from './dto/stream.dto';

const CACHE_KEY = 'streams:active';

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async getActiveStreams(): Promise<StreamDto[]> {
    const cached = await this.redis.getJson<StreamDto[]>(CACHE_KEY);
    if (cached) {
      return cached;
    }

    const streams = await this.prisma.stream.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const ttlSeconds = this.configService.get<number>(
      'streamCache.ttlSeconds',
    ) as number;
    await this.redis.setJson(CACHE_KEY, streams, ttlSeconds);
    this.logger.debug(
      `Cache miss for ${CACHE_KEY}; refreshed with TTL ${ttlSeconds}s`,
    );

    return streams;
  }
}
