import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),

  WEBHOOK_SIGNING_SECRET: Joi.string().min(32).required(),

  RATE_LIMIT_MAX: Joi.number().default(30),
  RATE_LIMIT_WINDOW_SECONDS: Joi.number().default(60),

  STREAM_CACHE_TTL_SECONDS: Joi.number().default(10),

  MEDIA_QUEUE_JOB_ATTEMPTS: Joi.number().default(3),
  MEDIA_QUEUE_BACKOFF_MS: Joi.number().default(2000),
});
