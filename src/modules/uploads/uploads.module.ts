import { Module } from '@nestjs/common';
import { CloudinaryProvider } from './cloudinary.provider.js';
import { UploadsService } from './uploads.service.js';

@Module({
  providers: [CloudinaryProvider, UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
