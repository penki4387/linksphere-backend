import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule);

  app.enableShutdownHooks();
  logger.log('Media moderation worker started, waiting for jobs...');

  process.on('SIGTERM', async () => {
    logger.log('SIGTERM received, closing worker gracefully');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
