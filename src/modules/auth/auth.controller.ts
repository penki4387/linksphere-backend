import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { MintTokenDto } from './dto/mint-token.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Test/simulation helper: mints a bearer JWT for a seeded user so the
   * protected endpoints in this assessment can be exercised without a real
   * identity provider. See README for the seeded user IDs.
   */
  @Post('token')
  async mintToken(
    @Body() dto: MintTokenDto,
  ): Promise<{ accessToken: string; expiresIn: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`No user with id ${dto.userId}`);
    }
    return this.authService.mintToken({
      userId: user.id,
      email: user.email,
      subscriptionTier: user.subscriptionTier,
    });
  }
}
