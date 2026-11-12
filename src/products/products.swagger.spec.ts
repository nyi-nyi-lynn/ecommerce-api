import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService } from '../auth/auth.service.js';
import { RbacController } from '../rbac/rbac.controller.js';
import { RbacService } from '../rbac/rbac.service.js';
import { CategoriesController } from '../categories/categories.controller.js';
import { CategoriesService } from '../categories/categories.service.js';
import { BrandsController } from '../brands/brands.controller.js';
import { BrandsService } from '../brands/brands.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { CartController } from '../cart/cart.controller.js';
import { CartService } from '../cart/cart.service.js';
import {
  AdminOrdersController,
  OrdersController,
} from '../orders/orders.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  AdminPaymentsController,
  PaymentsController,
} from '../payments/payments.controller.js';
import { PaymentsService } from '../payments/payments.service.js';
import { StockController } from '../stock/stock.controller.js';
import { StockService } from '../stock/stock.service.js';

describe('Swagger query parameters', () => {
  it('does not prepopulate optional GET filters with sample values', async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ProductsController,
        BrandsController,
        OrdersController,
        AdminOrdersController,
        AdminPaymentsController,
        StockController,
      ],
      providers: [
        { provide: ProductsService, useValue: {} },
        { provide: BrandsService, useValue: {} },
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
          new Set([
            'categoryId',
            'brandId',
            'brandSlug',
            'hasDiscount',
            'minPrice',
            'maxPrice',
            'search',
            'isActive',
          ]),
        ],
        ['/api/brands', new Set(['search', 'isActive'])],
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

  it('documents all entity ID path parameters, DTO properties, and response examples as UUID strings', async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        RbacController,
        CategoriesController,
        BrandsController,
        ProductsController,
        StockController,
        CartController,
        OrdersController,
        AdminOrdersController,
        PaymentsController,
        AdminPaymentsController,
      ],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: RbacService, useValue: {} },
        { provide: CategoriesService, useValue: {} },
        { provide: BrandsService, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: StockService, useValue: {} },
        { provide: CartService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
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

      const expectedUuidPathParams: Array<[string, string, string]> = [
        ['/api/rbac/roles/{id}', 'patch', 'id'],
        ['/api/rbac/roles/{id}/permissions', 'put', 'id'],
        ['/api/rbac/users/{id}/role', 'patch', 'id'],
        ['/api/categories/{id}', 'get', 'id'],
        ['/api/categories/{id}', 'patch', 'id'],
        ['/api/categories/{id}', 'delete', 'id'],
        ['/api/brands/{id}', 'get', 'id'],
        ['/api/brands/{id}', 'patch', 'id'],
        ['/api/brands/{id}', 'delete', 'id'],
        ['/api/products/{id}', 'get', 'id'],
        ['/api/products/{id}', 'patch', 'id'],
        ['/api/stock/products/{productId}/initialize', 'post', 'productId'],
        ['/api/stock/products/{productId}/adjustments', 'post', 'productId'],
        ['/api/stock/products/{productId}/movements', 'get', 'productId'],
        ['/api/stock/products/{productId}', 'get', 'productId'],
        ['/api/cart/items/{productId}', 'patch', 'productId'],
        ['/api/cart/items/{productId}', 'delete', 'productId'],
        ['/api/orders/{id}', 'get', 'id'],
        ['/api/orders/{id}/cancel', 'post', 'id'],
        ['/api/admin/orders/{id}', 'get', 'id'],
        ['/api/admin/orders/{id}/status', 'patch', 'id'],
        ['/api/payments/orders/{orderId}', 'get', 'orderId'],
        ['/api/payments/orders/{orderId}/manual', 'post', 'orderId'],
        ['/api/admin/payments/{attemptId}', 'get', 'attemptId'],
        ['/api/admin/payments/{attemptId}/approve', 'post', 'attemptId'],
        ['/api/admin/payments/{attemptId}/reject', 'post', 'attemptId'],
        ['/api/admin/payments/orders/{orderId}/collect-cod', 'post', 'orderId'],
      ];

      for (const [path, method, paramName] of expectedUuidPathParams) {
        const operation = (
          document.paths[path] as Record<
            string,
            { parameters?: Array<Record<string, unknown>> }
          >
        )?.[method];
        expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
        const param = (operation?.parameters ?? []).find(
          (p) => p.in === 'path' && p.name === paramName,
        );
        expect(
          param,
          `${method.toUpperCase()} ${path} path param ${paramName}`,
        ).toMatchObject({
          in: 'path',
          name: paramName,
          required: true,
          schema: {
            type: 'string',
            format: 'uuid',
          },
        });
        const exampleValue =
          param?.example ??
          (param?.schema as Record<string, unknown> | undefined)?.example;
        expect(
          isUUID(String(exampleValue)),
          `${method.toUpperCase()} ${path} path param ${paramName} example`,
        ).toBe(true);
      }

      // Check query parameter categoryId on GET /api/products
      const productQueryParams =
        document.paths['/api/products']?.get?.parameters ?? [];
      const categoryIdQuery = productQueryParams.find(
        (p) => !('$ref' in p) && p.in === 'query' && p.name === 'categoryId',
      );
      expect(categoryIdQuery).toMatchObject({
        in: 'query',
        name: 'categoryId',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
        },
      });

      // Check component schemas for UUID fields
      const schemas = (document.components?.schemas ?? {}) as Record<
        string,
        {
          required?: string[];
          properties?: Record<string, Record<string, unknown>>;
        }
      >;
      expect(schemas.AssignUserRoleDto?.properties?.roleId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
      expect(
        schemas.SetRolePermissionsDto?.properties?.permissionIds,
      ).toMatchObject({
        type: 'array',
        items: {
          type: 'string',
          format: 'uuid',
        },
      });
      expect(schemas.CreateProductDto?.properties?.categoryId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
      expect(schemas.CreateProductDto?.properties?.brandId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
      expect(schemas.UpdateProductDto?.properties?.categoryId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
      expect(schemas.UpdateProductDto?.properties?.brandId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
      expect(schemas.AddCartItemDto?.properties?.productId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
      expect(schemas.CreateOrderItemDto?.properties?.productId).toMatchObject({
        type: 'string',
        format: 'uuid',
      });

      // Verify required fields on Create DTOs vs optional fields on PartialType Update DTOs
      expect(schemas.CreateCategoryDto?.required).toEqual(
        expect.arrayContaining(['name', 'slug']),
      );
      expect(schemas.UpdateCategoryDto?.required ?? []).toHaveLength(0);

      expect(schemas.CreateBrandDto?.required).toEqual(
        expect.arrayContaining(['name', 'slug']),
      );
      expect(schemas.UpdateBrandDto?.required ?? []).toHaveLength(0);

      expect(schemas.CreateProductDto?.required).toEqual(
        expect.arrayContaining(['name', 'slug', 'sku', 'price', 'categoryId']),
      );
      expect(schemas.UpdateProductDto?.required ?? []).toHaveLength(0);

      expect(schemas.CreateRoleDto?.required).toEqual(
        expect.arrayContaining(['name']),
      );
      expect(schemas.UpdateRoleDto?.required ?? []).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
