import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { HmacSignatureGuard } from './guards/hmac-signature.guard';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, HmacSignatureGuard],
})
export class PaymentsModule {}
