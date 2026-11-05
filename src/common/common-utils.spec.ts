import { ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { extractCurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface.js';
import { CreateCategoryDto } from '../categories/dto/create-category.dto.js';
import { UpdateCategoryDto } from '../categories/dto/update-category.dto.js';
import { CreateOrderDto } from '../orders/dto/create-order.dto.js';
import { QueryProductsDto } from '../products/dto/query-products.dto.js';
import { UpdateProductDto } from '../products/dto/update-product.dto.js';
import {
  MAX_LIMIT,
  MAX_PAGE,
  PaginationQueryDto,
} from './pagination/pagination-query.dto.js';
import {
  buildPaginatedResponse,
  resolvePaginationParams,
} from './pagination/pagination.util.js';
import { hasPrismaErrorCode } from './prisma/prisma-error.util.js';
import { transformBooleanValue } from './transformers/transform-boolean.decorator.js';

describe('Shared Utilities & Refactored DTOs', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000042';
  const PRODUCT_ID = '00000000-0000-4000-8000-000000000005';

  describe('hasPrismaErrorCode', () => {
    it('returns true only when the error is an object with a matching code', () => {
      expect(hasPrismaErrorCode({ code: 'P2002' }, 'P2002')).toBe(true);
      expect(hasPrismaErrorCode({ code: 'P2025' }, 'P2002')).toBe(false);
      expect(hasPrismaErrorCode(new Error('plain error'), 'P2002')).toBe(false);
      expect(hasPrismaErrorCode(null, 'P2002')).toBe(false);
      expect(hasPrismaErrorCode(undefined, 'P2002')).toBe(false);
      expect(hasPrismaErrorCode('P2002', 'P2002')).toBe(false);
    });
  });

  describe('PaginationQueryDto and pagination utilities', () => {
    it('resolves default and explicit pagination parameters and builds metadata', () => {
      expect(resolvePaginationParams({})).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
      expect(resolvePaginationParams({ page: 3, limit: 15 })).toEqual({
        page: 3,
        limit: 15,
        skip: 30,
      });
      expect(buildPaginatedResponse(['a', 'b'], 41, 3, 20)).toEqual({
        items: ['a', 'b'],
        pagination: {
          page: 3,
          limit: 20,
          total: 41,
          totalPages: 3,
        },
      });
    });

    it('validates page and limit bounds on PaginationQueryDto', () => {
      const valid = plainToInstance(PaginationQueryDto, {
        page: String(MAX_PAGE),
        limit: String(MAX_LIMIT),
      });
      expect(validateSync(valid)).toHaveLength(0);
      expect(valid.page).toBe(MAX_PAGE);
      expect(valid.limit).toBe(MAX_LIMIT);

      const invalid = plainToInstance(PaginationQueryDto, {
        page: MAX_PAGE + 1,
        limit: MAX_LIMIT + 1,
      });
      expect(validateSync(invalid)).toHaveLength(2);
    });
  });

  describe('@TransformBoolean()', () => {
    it('maps true, "true", false, and "false" while preserving invalid inputs for @IsBoolean() rejection', () => {
      expect(transformBooleanValue(true)).toBe(true);
      expect(transformBooleanValue('true')).toBe(true);
      expect(transformBooleanValue(false)).toBe(false);
      expect(transformBooleanValue('false')).toBe(false);
      expect(transformBooleanValue('not-a-bool')).toBe('not-a-bool');

      for (const DtoClass of [
        CreateCategoryDto,
        UpdateCategoryDto,
        UpdateProductDto,
        QueryProductsDto,
      ]) {
        const fromTrueString = plainToInstance(DtoClass, {
          name: 'Valid Name',
          slug: 'valid-slug',
          isActive: 'true',
        });
        expect(fromTrueString.isActive).toBe(true);

        const fromFalseString = plainToInstance(DtoClass, {
          name: 'Valid Name',
          slug: 'valid-slug',
          isActive: 'false',
        });
        expect(fromFalseString.isActive).toBe(false);
        expect(validateSync(fromFalseString)).toHaveLength(0);

        const fromInvalidString = plainToInstance(DtoClass, {
          name: 'Valid Name',
          slug: 'valid-slug',
          isActive: 'not-a-bool',
        });
        expect(fromInvalidString.isActive).toBe('not-a-bool');
        const errors = validateSync(fromInvalidString);
        expect(errors.some((err) => err.property === 'isActive')).toBe(true);
      }
    });
  });

  describe('@CurrentUser() extractor', () => {
    it('extracts the full user or a requested JwtPayload property from the request', () => {
      const user: JwtPayload = {
        sub: USER_ID,
        email: 'user@example.com',
        role: 'CUSTOMER',
      };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ user }),
        }),
      } as unknown as ExecutionContext;

      expect(extractCurrentUser(undefined, ctx)).toEqual(user);
      expect(extractCurrentUser('sub', ctx)).toBe(USER_ID);
      expect(extractCurrentUser('email', ctx)).toBe('user@example.com');
      expect(extractCurrentUser('role', ctx)).toBe('CUSTOMER');
    });
  });

  describe('CreateOrderDto inheritance from CheckoutOrderDto', () => {
    it('preserves shipping field trimming, validation, and items array validation', () => {
      const valid = plainToInstance(CreateOrderDto, {
        items: [{ productId: PRODUCT_ID, quantity: 2 }],
        paymentMethod: 'MANUAL',
        shippingName: '  Ada Lovelace  ',
        shippingPhone: '  0912345678  ',
        shippingAddress: '  42 Analytical Engine Way  ',
        note: '  Leave at door  ',
      });
      expect(validateSync(valid)).toHaveLength(0);
      expect(valid.shippingName).toBe('Ada Lovelace');
      expect(valid.shippingPhone).toBe('0912345678');
      expect(valid.shippingAddress).toBe('42 Analytical Engine Way');
      expect(valid.note).toBe('  Leave at door  ');

      const invalid = plainToInstance(CreateOrderDto, {
        items: [],
        paymentMethod: 'GATEWAY',
        shippingName: '   ',
        shippingPhone: '',
        shippingAddress: '',
      });
      const errors = validateSync(invalid);
      const properties = errors.map((err) => err.property);
      expect(properties).toEqual(
        expect.arrayContaining([
          'items',
          'paymentMethod',
          'shippingName',
          'shippingPhone',
          'shippingAddress',
        ]),
      );
    });
  });
});
