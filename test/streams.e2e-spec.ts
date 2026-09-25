import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './utils/test-app.factory';

describe('Streams (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    await prisma.stream.createMany({
      data: [
        { title: 'Integration Test Stream', isActive: true, viewerCount: 1 },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function mintTokenForFreshUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `streams-${randomUUID()}@test.local` },
    });
    const jwtService = app.get(JwtService);
    return jwtService.sign({
      sub: user.id,
      email: user.email,
      subscriptionTier: user.subscriptionTier,
    });
  }

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/streams/active',
    );
    expect(res.status).toBe(401);
  });

  it('returns active streams for an authenticated user', async () => {
    const token = await mintTokenForFreshUser();

    const res = await request(app.getHttpServer())
      .get('/api/v1/streams/active')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.some(
        (s: { title: string }) => s.title === 'Integration Test Stream',
      ),
    ).toBe(true);
  });

  it('enforces the rate limit and returns 429 with Retry-After once exceeded', async () => {
    const token = await mintTokenForFreshUser();
    const limit = Number(process.env.RATE_LIMIT_MAX);
    const authHeader = `Bearer ${token}`;

    // Consume the full allowance for this user.
    for (let i = 0; i < limit; i++) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/streams/active')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    }

    // The next request must be rejected.
    const limited = await request(app.getHttpServer())
      .get('/api/v1/streams/active')
      .set('Authorization', authHeader);

    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.message).toContain('Too many requests');
  });

  it('rate-limits are tracked independently per user', async () => {
    const tokenA = await mintTokenForFreshUser();
    const tokenB = await mintTokenForFreshUser();
    const limit = Number(process.env.RATE_LIMIT_MAX);

    for (let i = 0; i < limit; i++) {
      await request(app.getHttpServer())
        .get('/api/v1/streams/active')
        .set('Authorization', `Bearer ${tokenA}`);
    }

    const exhaustedA = await request(app.getHttpServer())
      .get('/api/v1/streams/active')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(exhaustedA.status).toBe(429);

    const freshB = await request(app.getHttpServer())
      .get('/api/v1/streams/active')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(freshB.status).toBe(200);
  });
});
