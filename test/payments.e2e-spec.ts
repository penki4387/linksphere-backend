import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, signWebhookPayload } from './utils/test-app.factory';

describe('Payments webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: { email: `payments-${randomUUID()}@test.local`, balanceCents: 0 },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const buildPayload = (eventId: string, amountCents = 1500) => ({
    eventId,
    provider: 'stripe',
    type: 'BALANCE_CREDIT',
    userId,
    amountCents,
  });

  describe('HMAC signature verification', () => {
    it('rejects a request with an invalid signature', async () => {
      const payload = buildPayload(`evt_${randomUUID()}`);
      const body = JSON.stringify(payload);

      const res = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', '0'.repeat(64))
        .send(body);

      expect(res.status).toBe(401);
    });

    it('rejects a request with no signature header at all', async () => {
      const payload = buildPayload(`evt_${randomUUID()}`);

      const res = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .send(payload);

      expect(res.status).toBe(401);
    });

    it('accepts a request with a correctly computed signature', async () => {
      const payload = buildPayload(`evt_${randomUUID()}`);
      const body = JSON.stringify(payload);
      const signature = signWebhookPayload(body);

      const res = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', signature)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processed');
    });
  });

  describe('idempotency', () => {
    it('ignores a sequential replay of the same event without crediting twice', async () => {
      const eventId = `evt_${randomUUID()}`;
      const payload = buildPayload(eventId, 1000);
      const body = JSON.stringify(payload);
      const signature = signWebhookPayload(body);

      const first = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', signature)
        .send(body);
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('processed');

      const second = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', signature)
        .send(body);
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('duplicate');

      const transactionCount = await prisma.transaction.count({
        where: { eventId },
      });
      expect(transactionCount).toBe(1);
    });

    it('processes exactly once when 10 identical requests arrive concurrently', async () => {
      const eventId = `evt_${randomUUID()}`;
      const amountCents = 2500;
      const payload = buildPayload(eventId, amountCents);
      const body = JSON.stringify(payload);
      const signature = signWebhookPayload(body);

      const userBefore = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app.getHttpServer())
            .post('/api/v1/payments/webhook')
            .set('Content-Type', 'application/json')
            .set('X-Webhook-Signature', signature)
            .send(body),
        ),
      );

      // Every request must be acknowledged with 200, per gateway contract.
      expect(responses.every((r) => r.status === 200)).toBe(true);

      const processed = responses.filter((r) => r.body.status === 'processed');
      const duplicates = responses.filter((r) => r.body.status === 'duplicate');
      expect(processed).toHaveLength(1);
      expect(duplicates).toHaveLength(9);

      const transactionCount = await prisma.transaction.count({
        where: { eventId },
      });
      expect(transactionCount).toBe(1);

      const userAfter = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(userAfter.balanceCents - userBefore.balanceCents).toBe(
        amountCents,
      );
    });
  });
});
