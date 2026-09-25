import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { WebhookEventType, WebhookPayloadDto } from './dto/webhook-payload.dto';

export interface WebhookResult {
  status: 'processed' | 'duplicate';
  eventId: string;
  balanceCents?: number;
  subscriptionTier?: string;
}

const LOCK_TTL_MS = 15_000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async handleWebhook(
    dto: WebhookPayloadDto,
    rawBody: Buffer,
  ): Promise<WebhookResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`No user with id ${dto.userId}`);
    }

    const lockKey = `webhook-lock:${dto.eventId}`;
    const lockToken = await this.redis.acquireLock(lockKey, LOCK_TTL_MS);

    try {
      if (!lockToken) {
        // Another request already holds the lock for this event. If it has
        // already committed, we can short-circuit; otherwise fall through
        // and let the Postgres unique constraint be the final arbiter.
        const existing = await this.prisma.processedWebhook.findUnique({
          where: { eventId: dto.eventId },
        });
        if (existing) {
          this.logger.log(
            `Duplicate webhook ignored (lock busy): ${dto.eventId}`,
          );
          return { status: 'duplicate', eventId: dto.eventId };
        }
      }

      return await this.persistWebhookAtomically(dto, rawBody);
    } finally {
      if (lockToken) {
        await this.redis.releaseLock(lockKey, lockToken);
      }
    }
  }

  private async persistWebhookAtomically(
    dto: WebhookPayloadDto,
    rawBody: Buffer,
  ): Promise<WebhookResult> {
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // The unique constraint on eventId is the actual correctness
        // guarantee: two concurrent transactions for the same event can
        // both reach this point, but only one INSERT will succeed.
        await tx.processedWebhook.create({
          data: { eventId: dto.eventId, provider: dto.provider, payloadHash },
        });

        if (dto.type === WebhookEventType.BALANCE_CREDIT) {
          await tx.transaction.create({
            data: {
              userId: dto.userId,
              amountCents: dto.amountCents as number,
              type: TransactionType.CREDIT,
              eventId: dto.eventId,
              provider: dto.provider,
            },
          });
          return tx.user.update({
            where: { id: dto.userId },
            data: { balanceCents: { increment: dto.amountCents as number } },
          });
        }

        // SUBSCRIPTION_UPGRADE: recorded as a zero-amount ledger entry for
        // audit purposes; the tier change is the actual side effect.
        await tx.transaction.create({
          data: {
            userId: dto.userId,
            amountCents: 0,
            type: TransactionType.CREDIT,
            eventId: dto.eventId,
            provider: dto.provider,
          },
        });
        return tx.user.update({
          where: { id: dto.userId },
          data: { subscriptionTier: dto.tier },
        });
      });

      this.logger.log(
        `Processed webhook ${dto.eventId} for user ${dto.userId}`,
      );
      return {
        status: 'processed',
        eventId: dto.eventId,
        balanceCents: user.balanceCents,
        subscriptionTier: user.subscriptionTier,
      };
    } catch (err) {
      if (this.isUniqueConstraintViolation(err, 'eventId')) {
        this.logger.log(
          `Duplicate webhook ignored (DB constraint): ${dto.eventId}`,
        );
        return { status: 'duplicate', eventId: dto.eventId };
      }
      throw err;
    }
  }

  private isUniqueConstraintViolation(err: unknown, field: string): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      Array.isArray(err.meta?.target) &&
      (err.meta?.target as string[]).includes(field)
    );
  }
}
