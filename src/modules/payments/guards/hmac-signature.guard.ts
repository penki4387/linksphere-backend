import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Verifies the HMAC-SHA256 signature of the raw request body against a
 * shared secret, using a constant-time comparison to avoid leaking timing
 * information about how many bytes matched.
 */
@Injectable()
export class HmacSignatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const signature = request.headers[WEBHOOK_SIGNATURE_HEADER];

    if (!signature || typeof signature !== 'string') {
      throw new UnauthorizedException(
        `Missing ${WEBHOOK_SIGNATURE_HEADER} header`,
      );
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new InternalServerErrorException(
        'Raw request body is unavailable for signature verification',
      );
    }

    const secret = this.configService.get<string>('webhook.signingSecret');
    const expectedHex = createHmac('sha256', secret as string)
      .update(rawBody)
      .digest('hex');

    if (!this.isValidSignature(expectedHex, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }

  private isValidSignature(expectedHex: string, providedHex: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    let provided: Buffer;
    try {
      provided = Buffer.from(providedHex, 'hex');
    } catch {
      return false;
    }

    // timingSafeEqual throws on length mismatch; comparing against a
    // same-length buffer of the expected value keeps this branch itself
    // constant-time relative to a correctly-sized forged signature.
    if (provided.length !== expected.length) {
      timingSafeEqual(expected, expected);
      return false;
    }

    return timingSafeEqual(expected, provided);
  }
}
