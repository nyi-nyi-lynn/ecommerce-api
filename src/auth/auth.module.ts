import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Module({
  imports : [
    JwtModule.registerAsync({
      inject : [ConfigService],
      useFactory : (config : ConfigService) => ({
        secret : config.getOrThrow<string>(`JWT_SECRET`),
        signOptions : {expiresIn : '2h'}
      }),
    })
  ],
  controllers: [AuthController],
  providers: [AuthService]
})
export class AuthModule {}
