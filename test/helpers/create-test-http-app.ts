import {
  INestApplication,
  ModuleMetadata,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../../src/common/http/global-exception.filter.js';
import { ResponseInterceptor } from '../../src/common/http/response.interceptor.js';

export interface CreateTestHttpAppOptions extends ModuleMetadata {
  customizeBuilder?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createTestHttpApp(
  options: CreateTestHttpAppOptions,
): Promise<INestApplication> {
  const { customizeBuilder, providers = [], ...metadata } = options;

  let builder = Test.createTestingModule({
    ...metadata,
    providers: [
      ...providers,
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    ],
  });

  if (customizeBuilder) {
    builder = customizeBuilder(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

