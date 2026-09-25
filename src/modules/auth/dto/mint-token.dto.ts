import { IsEmail, IsEnum, IsUUID } from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

/**
 * Simulates what a real identity provider would issue after login.
 * There is no login/signup flow in scope for this assessment — this
 * endpoint exists purely so the reviewer can mint a bearer token for a
 * seeded user to exercise the protected endpoints.
 */
export class MintTokenDto {
  @IsUUID()
  userId: string;

  @IsEmail()
  email: string;

  @IsEnum(SubscriptionTier)
  subscriptionTier: SubscriptionTier;
}
