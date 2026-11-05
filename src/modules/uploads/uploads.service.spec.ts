import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UploadsService } from './uploads.service.js';

describe('UploadsService', () => {
  let configValues: Record<string, string>;
  let cloudinary: any;
  let service: UploadsService;

  beforeEach(() => {
    configValues = {
      CLOUDINARY_CLOUD_NAME: 'demo',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
    };
    const config = {
      get: (key: string) => configValues[key],
    } as ConfigService;
    cloudinary = {
      uploader: {
        upload_stream: vi.fn((_options, callback) => ({
          end: () =>
            callback(null, {
              secure_url:
                'https://res.cloudinary.com/demo/image/upload/test.jpg',
              public_id: 'ecommerce/products/users/7/test',
              format: 'jpg',
              width: 800,
              height: 600,
              bytes: 123,
            }),
        })),
        destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
      },
    };
    service = new UploadsService(cloudinary, config);
  });

  const imageFile = (
    size = 1000,
    mimeType = 'image/png',
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'test.png',
    encoding: '7bit',
    mimetype: mimeType,
    size,
    destination: '',
    filename: '',
    path: '',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XWJ2AAAAAElFTkSuQmCC',
      'base64',
    ),
    stream: undefined as any,
  });

  it('uploads a valid image and returns only required asset metadata', async () => {
    await expect(service.uploadProductImage(imageFile(), 7)).resolves.toEqual({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/test.jpg',
      public_id: 'ecommerce/products/users/7/test',
      format: 'jpg',
      width: 800,
      height: 600,
      bytes: 123,
    });
  });

  it('rejects missing and empty files', async () => {
    await expect(
      service.uploadProductImage(undefined, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadProductImage({ ...imageFile(), size: 0 }, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized files', async () => {
    await expect(
      service.uploadProductImage(imageFile(5 * 1024 * 1024 + 1), 7),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects spoofed MIME content', async () => {
    const file = {
      ...imageFile(),
      buffer: Buffer.from('<script>alert(1)</script>'),
      mimetype: 'image/png',
    };
    await expect(service.uploadProductImage(file, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps Cloudinary failures to a safe service unavailable response', async () => {
    cloudinary.uploader.upload_stream.mockImplementation(
      (_options: unknown, callback: (error: Error) => void) => ({
        end: () => callback(new Error('upstream secret detail')),
      }),
    );
    await expect(
      service.uploadProductImage(imageFile(), 7),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails safely when Cloudinary credentials are missing', async () => {
    configValues = {};
    await expect(
      service.uploadProductImage(imageFile(), 7),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('only destroys assets in the designated product folder', async () => {
    await expect(
      service.deleteProductImage('other/folder/image'),
    ).resolves.toBe(false);
    await expect(
      service.deleteProductImage('ecommerce/products/users/7/image'),
    ).resolves.toBe(true);
  });

  it('uploads category images into the category folder', async () => {
    cloudinary.uploader.upload_stream.mockImplementation(
      (_options: unknown, callback: (error: null, result: any) => void) => ({
        end: () =>
          callback(null, {
            secure_url:
              'https://res.cloudinary.com/demo/image/upload/category.jpg',
            public_id: 'ecommerce/categories/users/7/category',
            format: 'jpg',
            width: 800,
            height: 600,
            bytes: 123,
          }),
      }),
    );

    await expect(
      service.uploadCategoryImage(imageFile(), 7),
    ).resolves.toMatchObject({
      public_id: 'ecommerce/categories/users/7/category',
    });
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'ecommerce/categories/users/7' }),
      expect.any(Function),
    );
  });

  it('only destroys assets in the designated category folder', async () => {
    await expect(
      service.deleteCategoryImage('other/folder/image'),
    ).resolves.toBe(false);
    await expect(
      service.deleteCategoryImage('ecommerce/categories/users/7/image'),
    ).resolves.toBe(true);
  });
});
