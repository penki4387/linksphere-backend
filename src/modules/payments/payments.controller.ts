import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { HmacSignatureGuard } from './guards/hmac-signature.guard';
import { PaymentsService, WebhookResult } from './payments.service';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';

@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  @UseGuards(HmacSignatureGuard)
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() dto: WebhookPayloadDto,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<WebhookResult> {
    // Gateways expect 200 OK for both a freshly processed event and a
    // replayed duplicate — only genuine failures (bad signature, invalid
    // payload, missing user) should surface a non-2xx status.
    return this.paymentsService.handleWebhook(dto, req.rawBody as Buffer);
  }
}
