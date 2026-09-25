import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './common/redis/redis.service';

interface HealthStatus {
  status: 'ok';
  postgres: 'up';
  redis: 'up';
}

@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.client.ping();
      return { status: 'ok', postgres: 'up', redis: 'up' };
    } catch (err) {
      throw new ServiceUnavailableException(
        `Dependency check failed: ${(err as Error).message}`,
      );
    }
  }
}
