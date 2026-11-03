import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export const CLOUDINARY = Symbol('CLOUDINARY');

export const CloudinaryProvider: Provider = {
  provide: CLOUDINARY,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME')?.trim();
    const apiKey = config.get<string>('CLOUDINARY_API_KEY')?.trim();
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET')?.trim();

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }

    return cloudinary;
  },
};
