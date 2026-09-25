export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },

  webhook: {
    signingSecret: process.env.WEBHOOK_SIGNING_SECRET,
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '30', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10),
  },

  streamCache: {
    ttlSeconds: parseInt(process.env.STREAM_CACHE_TTL_SECONDS ?? '10', 10),
  },

  mediaQueue: {
    jobAttempts: parseInt(process.env.MEDIA_QUEUE_JOB_ATTEMPTS ?? '3', 10),
    backoffMs: parseInt(process.env.MEDIA_QUEUE_BACKOFF_MS ?? '2000', 10),
  },
});
