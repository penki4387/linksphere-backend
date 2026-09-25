import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { RedisService } from '../../../common/redis/redis.service';
import { AuthenticatedUser } from '../../auth/jwt-payload.interface';

/**
 * Redis-backed sliding-window rate limiter. Keys by authenticated user id
 * when available, falling back to IP for unauthenticated callers. State
 * lives in Redis (not process memory), so limits survive app restarts and
 * are shared across horizontally-scaled instances.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const user = request.user as AuthenticatedUser | undefined;
    const identifier = user?.userId ?? request.ip;
    const key = `ratelimit:streams:${identifier}`;

    const max = this.configService.get<number>('rateLimit.max') as number;
    const windowSeconds = this.configService.get<number>(
      'rateLimit.windowSeconds',
    ) as number;

    const { allowed, remaining, retryAfterMs } =
      await this.redis.slidingWindowRateLimit(key, max, windowSeconds);

    response.setHeader('X-RateLimit-Limit', max);
    response.setHeader('X-RateLimit-Remaining', Math.max(remaining, 0));

    if (!allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      response.setHeader('Retry-After', retryAfterSeconds);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later.',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
