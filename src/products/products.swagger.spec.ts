import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import {
  AdminOrdersController,
  OrdersController,
} from '../orders/orders.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import { AdminPaymentsController } from '../payments/payments.controller.js';
import { PaymentsService } from '../payments/payments.service.js';
import { StockController } from '../stock/stock.controller.js';
import { StockService } from '../stock/stock.service.js';

describe('Swagger query parameters', () => {
  it('does not prepopulate optional GET filters with sample values', async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ProductsController,
        OrdersController,
        AdminOrdersController,
        AdminPaymentsController,
        StockController,
      ],
      providers: [
        { provide: ProductsService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: StockService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api');

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const optionalFiltersByPath = new Map([
        [
          '/api/products',
          new Set(['categoryId', 'minPrice', 'maxPrice', 'search', 'isActive']),
        ],
        ['/api/admin/orders', new Set(['status'])],
        ['/api/admin/payments', new Set(['status'])],
      ]);

      for (const [path, filters] of optionalFiltersByPath) {
        const parameters = document.paths[path]?.get?.parameters;
        expect(parameters, `${path} query parameters`).toBeDefined();
        for (const parameter of parameters ?? []) {
          if (
            '$ref' in parameter ||
            parameter.in !== 'query' ||
            !filters.has(parameter.name)
          ) {
            continue;
          }
          expect(parameter.schema).not.toHaveProperty('example');
        }
      }
    } finally {
      await app.close();
    }
  });

  it('documents pagination as optional int32 query parameters on every affected endpoint', async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ProductsController,
        OrdersController,
        AdminOrdersController,
        AdminPaymentsController,
        StockController,
      ],
      providers: [
        { provide: ProductsService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: StockService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api');

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const paginationByPath = new Map([
        ['/api/admin/payments', { page: 1, limit: 20 }],
        ['/api/admin/orders', { page: 1, limit: 20 }],
        ['/api/orders', { page: 1, limit: 20 }],
        ['/api/stock/products/{productId}/movements', { page: 1, limit: 20 }],
      ]);
      const statusEnumsByPath = new Map([
        [
          '/api/admin/payments',
          [
            'PENDING',
            'UNDER_REVIEW',
            'PAID',
            'REJECTED',
            'FAILED',
            'CANCELLED',
          ],
        ],
        [
          '/api/admin/orders',
          [
            'PENDING',
            'CONFIRMED',
            'PROCESSING',
            'SHIPPED',
            'DELIVERED',
            'CANCELLED',
          ],
        ],
      ]);

      for (const [path, defaults] of paginationByPath) {
        const parameters = document.paths[path]?.get?.parameters ?? [];
        for (const [name, defaultValue] of Object.entries(defaults)) {
          const matching = parameters.filter(
            (parameter) =>
              !('$ref' in parameter) &&
              parameter.in === 'query' &&
              parameter.name === name,
          );
          expect(matching, `${path} ${name} definitions`).toHaveLength(1);
          const parameter = matching[0];
          expect(
            parameter && !('$ref' in parameter) ? parameter : undefined,
          ).toMatchObject({
            required: false,
            schema: {
              type: 'integer',
              format: 'int32',
              default: defaultValue,
            },
          });
          if (parameter && !('$ref' in parameter)) {
            expect(parameter.schema).not.toHaveProperty('allOf');
          }
        }
      }

      for (const [path, expectedEnum] of statusEnumsByPath) {
        const parameters = document.paths[path]?.get?.parameters ?? [];
        const statusParameters = parameters.filter(
          (parameter) => !('$ref' in parameter) && parameter.name === 'status',
        );
        expect(statusParameters, `${path} status definitions`).toHaveLength(1);
        const statusParameter = statusParameters[0];
        expect(
          statusParameter && !('$ref' in statusParameter)
            ? statusParameter
            : undefined,
        ).toMatchObject({
          in: 'query',
          required: false,
          schema: { type: 'string', enum: expectedEnum },
        });
      }
    } finally {
      await app.close();
    }
  });
});
