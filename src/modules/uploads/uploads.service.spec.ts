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

  it('1. deletes user-scoped product images', async () => {
    await expect(
      service.deleteProductImage('ecommerce/products/users/7/image'),
    ).resolves.toBe(true);
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
      'ecommerce/products/users/7/image',
      { resource_type: 'image', invalidate: true },
    );
  });

  it('2. deletes user-scoped category images', async () => {
    await expect(
      service.deleteCategoryImage('ecommerce/categories/users/7/image'),
    ).resolves.toBe(true);
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
      'ecommerce/categories/users/7/image',
      { resource_type: 'image', invalidate: true },
    );
  });

  it('3. supports valid unscoped product and category image deletion when uploaded without userId', async () => {
    await expect(
      service.deleteProductImage('ecommerce/products/unscoped-asset'),
    ).resolves.toBe(true);
    await expect(
      service.deleteCategoryImage('ecommerce/categories/unscoped-asset'),
    ).resolves.toBe(true);
    expect(cloudinary.uploader.destroy).toHaveBeenCalledTimes(2);
  });

  it('4. rejects cross-resource folder deletion between products and categories', async () => {
    await expect(
      service.deleteProductImage('ecommerce/categories/users/7/image'),
    ).resolves.toBe(false);
    await expect(
      service.deleteProductImage('ecommerce/categories/unscoped'),
    ).resolves.toBe(false);
    await expect(
      service.deleteCategoryImage('ecommerce/products/users/7/image'),
    ).resolves.toBe(false);
    await expect(
      service.deleteCategoryImage('ecommerce/products/unscoped'),
    ).resolves.toBe(false);
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });

  it('5. rejects invalid, empty, external, or path-traversal public IDs', async () => {
    for (const invalidPublicId of [
      '',
      '   ',
      'other/folder/image',
      'ecommerce/products/',
      'ecommerce/categories/',
      'ecommerce/products/users/7/',
      'ecommerce/products/users//image',
      'ecommerce/products/../categories/image',
      'ecommerce/categories/users/7/../../products/image',
    ]) {
      await expect(
        service.deleteProductImage(invalidPublicId),
      ).resolves.toBe(false);
      await expect(
        service.deleteCategoryImage(invalidPublicId),
      ).resolves.toBe(false);
    }
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });

  it('6. handles Cloudinary deletion failures safely by returning false', async () => {
    cloudinary.uploader.destroy.mockRejectedValueOnce(
      new Error('Cloudinary network error'),
    );
    await expect(
      service.deleteProductImage('ecommerce/products/users/7/image'),
    ).resolves.toBe(false);

    cloudinary.uploader.destroy.mockRejectedValueOnce(
      new Error('Cloudinary network error'),
    );
    await expect(
      service.deleteCategoryImage('ecommerce/categories/users/7/image'),
    ).resolves.toBe(false);
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
});
