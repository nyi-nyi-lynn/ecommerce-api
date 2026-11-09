import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UploadApiResponse } from 'cloudinary';
import { v2 as cloudinarySdk } from 'cloudinary';
import { CLOUDINARY } from './cloudinary.provider.js';

export const PRODUCT_IMAGE_FOLDER = 'ecommerce/products';
export const CATEGORY_IMAGE_FOLDER = 'ecommerce/categories';
export const BRAND_IMAGE_FOLDER = 'ecommerce/brands';
export const PAYMENT_IMAGE_FOLDER = 'ecommerce/payments';
export const PAYMENT_PROOF_IMAGE_FOLDER = PAYMENT_IMAGE_FOLDER;
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export type ProductImageAsset = Pick<
  UploadApiResponse,
  'secure_url' | 'public_id' | 'format' | 'width' | 'height' | 'bytes'
>;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(CLOUDINARY) private readonly cloudinary: typeof cloudinarySdk,
    private readonly config: ConfigService,
  ) {}

  async uploadProductImage(
    file: Express.Multer.File | undefined,
    userId?: string,
    resourceFolder = userId === undefined
      ? PRODUCT_IMAGE_FOLDER
      : `${PRODUCT_IMAGE_FOLDER}/users/${userId}`,
  ) {
    return this.uploadImage(file, resourceFolder, 'Product');
  }

  async uploadCategoryImage(
    file: Express.Multer.File | undefined,
    userId?: string,
  ) {
    return this.uploadImage(
      file,
      userId === undefined
        ? CATEGORY_IMAGE_FOLDER
        : `${CATEGORY_IMAGE_FOLDER}/users/${userId}`,
      'Category',
    );
  }

  async deleteCategoryImage(publicId: string) {
    return this.deleteOwnedImage(publicId, CATEGORY_IMAGE_FOLDER, 'category');
  }

  async uploadBrandImage(
    file: Express.Multer.File | undefined,
    userId?: string,
  ) {
    return this.uploadImage(
      file,
      userId === undefined
        ? BRAND_IMAGE_FOLDER
        : `${BRAND_IMAGE_FOLDER}/users/${userId}`,
      'Brand',
    );
  }

  async deleteBrandImage(publicId: string) {
    return this.deleteOwnedImage(publicId, BRAND_IMAGE_FOLDER, 'brand');
  }

  async uploadImages(files: Express.Multer.File[] | undefined, folder: string) {
    if (!files?.length) return [];
    return Promise.all(
      files.map((file) => this.uploadProductImage(file, undefined, folder)),
    );
  }

  async deleteProductImage(publicId: string) {
    return this.deleteOwnedImage(publicId, PRODUCT_IMAGE_FOLDER, 'product');
  }

  isOwnedProductAsset(publicId: string) {
    return this.isOwnedAsset(publicId, PRODUCT_IMAGE_FOLDER);
  }

  isOwnedCategoryAsset(publicId: string) {
    return this.isOwnedAsset(publicId, CATEGORY_IMAGE_FOLDER);
  }

  isOwnedBrandAsset(publicId: string) {
    return this.isOwnedAsset(publicId, BRAND_IMAGE_FOLDER);
  }

  async uploadPaymentProofImage(
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    const normalizedUserId = userId?.trim();
    if (!normalizedUserId) {
      throw new BadRequestException(
        'User ID is required for payment proof image upload.',
      );
    }
    return this.uploadImage(
      file,
      `${PAYMENT_IMAGE_FOLDER}/users/${normalizedUserId}`,
      'Payment proof',
    );
  }

  async deletePaymentProofImage(publicId: string) {
    if (!this.isOwnedPaymentProofAsset(publicId)) return false;
    return this.deleteOwnedImage(
      publicId,
      PAYMENT_IMAGE_FOLDER,
      'payment proof',
    );
  }

  isOwnedPaymentProofAsset(publicId: string) {
    return (
      this.isOwnedAsset(publicId, PAYMENT_IMAGE_FOLDER) &&
      publicId.trim().startsWith(`${PAYMENT_IMAGE_FOLDER}/users/`)
    );
  }

  private isOwnedAsset(publicId: string, baseFolder: string): boolean {
    if (typeof publicId !== 'string') return false;
    const trimmed = publicId.trim();
    if (!trimmed.startsWith(`${baseFolder}/`)) {
      return false;
    }
    const remainder = trimmed.slice(baseFolder.length + 1);
    if (
      !remainder ||
      remainder.startsWith('/') ||
      remainder.endsWith('/') ||
      remainder.includes('//')
    ) {
      return false;
    }
    const segments = remainder.split('/');
    if (
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    ) {
      return false;
    }
    if (segments[0] === 'users') {
      return segments.length >= 3;
    }
    return true;
  }

  private async uploadImage(
    file: Express.Multer.File | undefined,
    resourceFolder: string,
    resourceName: string,
  ) {
    if (!file)
      throw new BadRequestException(`${resourceName} image file is required.`);
    if (!file.size)
      throw new BadRequestException(
        `The ${resourceName.toLowerCase()} image file is empty.`,
      );
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      throw new PayloadTooLargeException(
        `The ${resourceName.toLowerCase()} image must be 5 MB or smaller.`,
      );
    }

    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(file.buffer);
    if (
      !detected ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(
        detected.mime,
      )
    ) {
      throw new BadRequestException(
        `Only JPEG, PNG, WebP, and AVIF ${resourceName.toLowerCase()} images are allowed.`,
      );
    }

    const cloudinary = this.requireCloudinary();
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'image',
            folder: resourceFolder,
            overwrite: false,
            unique_filename: true,
          },
          (error, uploaded) => {
            if (error || !uploaded) {
              reject(
                error ?? new Error('Cloudinary returned no upload result.'),
              );
              return;
            }
            resolve(uploaded);
          },
        );
        stream.end(file.buffer);
      });

      return {
        secure_url: result.secure_url,
        public_id: result.public_id,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      };
    } catch {
      throw new ServiceUnavailableException(
        `${resourceName} image upload could not be completed.`,
      );
    }
  }

  private async deleteOwnedImage(
    publicId: string,
    baseFolder: string,
    resourceLabel = 'resource',
  ) {
    if (!this.isOwnedAsset(publicId, baseFolder)) return false;
    const cloudinary = this.requireCloudinary();
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      });
      return true;
    } catch {
      this.logger.error(`Cloudinary ${resourceLabel} image cleanup failed.`);
      return false;
    }
  }

  private requireCloudinary() {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME')?.trim();
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY')?.trim();
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET')?.trim();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }
    return this.cloudinary;
  }
}
