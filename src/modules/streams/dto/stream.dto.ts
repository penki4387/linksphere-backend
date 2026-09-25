import { SubscriptionTier } from '@prisma/client';

export class StreamDto {
  id: string;
  title: string;
  isActive: boolean;
  viewerCount: number;
  requiredTier: SubscriptionTier;
  createdAt: Date;
}
