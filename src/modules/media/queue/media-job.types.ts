export const MEDIA_MODERATION_QUEUE = 'media-moderation';
export const MEDIA_MODERATION_DLQ = 'media-moderation-dlq';

export interface MediaJobData {
  taskId: string;
  userId: string;
  videoUrl: string;
  /** Test-only hook to deterministically force a persistent failure. */
  simulateFailure?: boolean;
}

export interface DeadLetterJobData extends MediaJobData {
  error: string;
  failedAt: string;
}
