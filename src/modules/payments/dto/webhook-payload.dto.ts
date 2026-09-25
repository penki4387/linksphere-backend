import {
  IsEnum,
  IsInt,
  IsPositive,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

export enum WebhookEventType {
  BALANCE_CREDIT = 'BALANCE_CREDIT',
  SUBSCRIPTION_UPGRADE = 'SUBSCRIPTION_UPGRADE',
}

/**
 * Simulated gateway notification payload (Stripe/Razorpay/IAP-style).
 * `eventId` is the gateway's unique event identifier and doubles as our
 * idempotency key.
 */
export class WebhookPayloadDto {
  @IsString()
  eventId: string;

  @IsString()
  provider: string;

  @IsEnum(WebhookEventType)
  type: WebhookEventType;

  @IsUUID()
  userId: string;

  @ValidateIf(
    (dto: WebhookPayloadDto) => dto.type === WebhookEventType.BALANCE_CREDIT,
  )
  @IsInt()
  @IsPositive()
  amountCents?: number;

  @ValidateIf(
    (dto: WebhookPayloadDto) =>
      dto.type === WebhookEventType.SUBSCRIPTION_UPGRADE,
  )
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;
}
