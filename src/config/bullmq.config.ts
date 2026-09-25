import { ConfigService } from '@nestjs/config';
import { QueueOptions } from 'bullmq';

export const bullmqConnectionFactory = (
  config: ConfigService,
): QueueOptions => ({
  connection: {
    host: config.get<string>('redis.host'),
    port: config.get<number>('redis.port'),
    password: config.get<string>('redis.password'),
  },
});
