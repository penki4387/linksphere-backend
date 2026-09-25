import { SubscriptionTier } from '@prisma/client';

/** Custom claims embedded in issued JWTs. */
export interface JwtPayload {
  sub: string;
  email: string;
  subscriptionTier: SubscriptionTier;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  subscriptionTier: SubscriptionTier;
}
