import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MintTokenDto } from './dto/mint-token.dto';
import { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  mintToken(dto: MintTokenDto): { accessToken: string; expiresIn: string } {
    const payload: JwtPayload = {
      sub: dto.userId,
      email: dto.email,
      subscriptionTier: dto.subscriptionTier,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: this.configService.get<string>('jwt.expiresIn') as string,
    };
  }
}
