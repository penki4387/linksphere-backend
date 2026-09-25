import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { MediaModerationProcessor } from '../src/modules/media/media.processor';
import { MEDIA_MODERATION_DLQ } from '../src/modules/media/queue/media-job.types';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Registers the DLQ queue + the same processor the isolated worker process
 * runs, inside this test's own app instance — so the suite can assert on
 * full job lifecycles (retry -> DLQ) without spinning up a second process.
 */
async function createTestAppWithWorker(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule,
      BullModule.registerQueue({ name: MEDIA_MODERATION_DLQ }),
    ],
    providers: [MediaModerationProcessor],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollTaskStatus(
  app: INestApplication,
  token: string,
  taskId: string,
  target: string,
  timeoutMs = 10_000,
): Promise<request.Response> {
  const deadline = Date.now() + timeoutMs;
  let last: request.Response;
  do {
    last = await request(app.getHttpServer())
      .get(`/api/v1/media/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    if (last.body.status === target) return last;
    await sleep(250);
  } while (Date.now() < deadline);
  return last!;
}

describe('Media moderation pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    app = await createTestAppWithWorker();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: { email: `media-${randomUUID()}@test.local` },
    });
    token = app.get(JwtService).sign({
      sub: user.id,
      email: user.email,
      subscriptionTier: user.subscriptionTier,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated upload requests', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/media/upload-task')
      .send({ videoUrl: 'https://cdn.example.com/videos/a.mp4' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid videoUrl payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/media/upload-task')
      .set('Authorization', `Bearer ${token}`)
      .send({ videoUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('enqueues a task and eventually marks it COMPLETED', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/v1/media/upload-task')
      .set('Authorization', `Bearer ${token}`)
      .send({ videoUrl: 'https://cdn.example.com/videos/happy-path.mp4' });

    expect(upload.status).toBe(202);
    expect(upload.body.status).toBe('PENDING');

    const finalState = await pollTaskStatus(
      app,
      token,
      upload.body.taskId,
      'COMPLETED',
    );
    expect(finalState.body.status).toBe('COMPLETED');
  }, 15_000);

  it('retries a persistently-failing task 3 times then routes it to the DLQ as FAILED_MODERATION', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/v1/media/upload-task')
      .set('Authorization', `Bearer ${token}`)
      .send({
        videoUrl: 'https://cdn.example.com/videos/always-fails.mp4',
        simulateFailure: true,
      });

    expect(upload.status).toBe(202);

    const finalState = await pollTaskStatus(
      app,
      token,
      upload.body.taskId,
      'FAILED_MODERATION',
    );
    expect(finalState.body.status).toBe('FAILED_MODERATION');
    expect(finalState.body.attempts).toBe(3);
    expect(finalState.body.failReason).toContain(
      'Simulated persistent moderation failure',
    );

    const dlqQueue = app.get<Queue>(getQueueToken(MEDIA_MODERATION_DLQ));
    const dlqJobs = await dlqQueue.getJobs(['waiting', 'active', 'completed']);
    expect(dlqJobs.some((j) => j.data.taskId === upload.body.taskId)).toBe(
      true,
    );
  }, 15_000);
});
