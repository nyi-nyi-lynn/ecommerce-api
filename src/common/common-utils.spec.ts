import { ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { extractCurrentUser } from '../auth/decorators/current-user.decorator.js';
import { LoginDto } from '../auth/dto/login.dto.js';
import { RefreshTokenDto } from '../auth/dto/refresh-token.dto.js';
import { RegisterDto } from '../auth/dto/register.dto.js';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface.js';
import { CreateBrandDto } from '../brands/dto/create-brand.dto.js';
import { UpdateBrandDto } from '../brands/dto/update-brand.dto.js';
import { AddCartItemDto } from '../cart/dto/add-cart-item.dto.js';
import { UpdateCartItemDto } from '../cart/dto/update-cart-item.dto.js';
import { CreateCategoryDto } from '../categories/dto/create-category.dto.js';
import { UpdateCategoryDto } from '../categories/dto/update-category.dto.js';
import { CreateOrderDto } from '../orders/dto/create-order.dto.js';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto.js';
import { RejectPaymentDto } from '../payments/dto/reject-payment.dto.js';
import { SubmitManualPaymentDto } from '../payments/dto/submit-manual-payment.dto.js';
import { QueryProductsDto } from '../products/dto/query-products.dto.js';
import { UpdateProductDto } from '../products/dto/update-product.dto.js';
import { AssignUserRoleDto } from '../rbac/dto/assign-user-role.dto.js';
import { CreateRoleDto } from '../rbac/dto/create-role.dto.js';
import { SetRolePermissionsDto } from '../rbac/dto/set-role-permissions.dto.js';
import { UpdateRoleDto } from '../rbac/dto/update-role.dto.js';
import { AdjustStockDto } from '../stock/dto/adjust-stock.dto.js';
import { InitializeStockDto } from '../stock/dto/initialize-stock.dto.js';
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
import {
  transformNullableNumber,
  transformNullableString,
  transformOptionalNumber,
  transformTrimmedString,
  transformUpdateNullableNumber,
  transformUpdateNullableUuid,
} from './transformers/dto-transforms.util.js';
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

  describe('Shared DTO transformation utilities and standardized Create/Update/Action DTOs', () => {
    it('transforms strings, numbers, and nullable UUIDs consistently', () => {
      expect(transformTrimmedString('  hello  ')).toBe('hello');
      expect(transformTrimmedString(42)).toBe(42);

      expect(transformNullableString(undefined)).toBeUndefined();
      expect(transformNullableString(null)).toBeNull();
      expect(transformNullableString('   ')).toBeNull();
      expect(transformNullableString(' NULL ')).toBeNull();
      expect(transformNullableString('  text  ')).toBe('text');

      expect(transformOptionalNumber(undefined)).toBeUndefined();
      expect(transformOptionalNumber(null)).toBeNull();
      expect(transformOptionalNumber('')).toBeNaN();
      expect(transformOptionalNumber(' 125.5 ')).toBe(125.5);

      expect(transformNullableNumber(undefined)).toBeUndefined();
      expect(transformNullableNumber(null)).toBeNull();
      expect(transformNullableNumber('')).toBeNull();
      expect(transformNullableNumber('null')).toBeNull();
      expect(transformNullableNumber(' 250 ')).toBe(250);

      expect(transformUpdateNullableNumber(undefined)).toBeUndefined();
      expect(transformUpdateNullableNumber(null)).toBeNull();
      expect(transformUpdateNullableNumber('null')).toBeNull();
      expect(transformUpdateNullableNumber('')).toBeNaN();
      expect(transformUpdateNullableNumber(' 300 ')).toBe(300);

      expect(transformUpdateNullableUuid(undefined)).toBeUndefined();
      expect(transformUpdateNullableUuid(null)).toBeNull();
      expect(transformUpdateNullableUuid(' null ')).toBeNull();
      expect(transformUpdateNullableUuid('')).toBe('');
      expect(transformUpdateNullableUuid(`  ${PRODUCT_ID}  `)).toBe(PRODUCT_ID);
    });

    it('enforces partial update and nullability rules across UpdateCategoryDto, UpdateBrandDto, and UpdateRoleDto', () => {
      for (const UpdateDto of [
        UpdateCategoryDto,
        UpdateBrandDto,
        UpdateRoleDto,
      ]) {
        // Omitting all fields is valid
        expect(validateSync(plainToInstance(UpdateDto, {}))).toHaveLength(0);

        // Updating only name (trimmed) is valid
        const nameOnly = plainToInstance(UpdateDto, { name: '  Valid Role  ' });
        expect(validateSync(nameOnly)).toHaveLength(0);
        expect(nameOnly.name).toBe('Valid Role');

        // Nullable description accepts null or empty string (transformed to null)
        const nullDesc = plainToInstance(UpdateDto, { description: null });
        expect(validateSync(nullDesc)).toHaveLength(0);
        expect(nullDesc.description).toBeNull();

        // Explicit null or whitespace-only string on non-nullable name is rejected
        for (const badName of [null, '', '   ']) {
          const invalid = plainToInstance(UpdateDto, { name: badName });
          const errors = validateSync(invalid);
          expect(errors.some((e) => e.property === 'name')).toBe(true);
        }
      }

      // CreateCategoryDto, CreateBrandDto, CreateRoleDto reject whitespace-only names
      expect(
        validateSync(
          plainToInstance(CreateCategoryDto, { name: '   ', slug: 'valid' }),
        ).some((e) => e.property === 'name'),
      ).toBe(true);
      expect(
        validateSync(
          plainToInstance(CreateBrandDto, { name: '   ', slug: 'valid' }),
        ).some((e) => e.property === 'name'),
      ).toBe(true);
      expect(
        validateSync(plainToInstance(CreateRoleDto, { name: '   ' })).some(
          (e) => e.property === 'name',
        ),
      ).toBe(true);
    });

    it('keeps required fields strictly required on action and state-transition DTOs', () => {
      for (const [ActionDto, expectedProps] of [
        [RegisterDto, ['name', 'email', 'password']],
        [LoginDto, ['email', 'password']],
        [RefreshTokenDto, ['refreshToken']],
        [InitializeStockDto, ['quantity']],
        [AdjustStockDto, ['quantityChange', 'reason']],
        [AddCartItemDto, ['productId', 'quantity']],
        [UpdateCartItemDto, ['quantity']],
        [UpdateOrderStatusDto, ['status']],
        [SubmitManualPaymentDto, ['providerCode', 'transactionReference']],
        [RejectPaymentDto, ['reason']],
        [AssignUserRoleDto, ['roleId']],
        [SetRolePermissionsDto, ['permissionIds']],
      ] as const) {
        const errors = validateSync(plainToInstance(ActionDto as any, {}));
        const errorProps = errors.map((e) => e.property);
        expect(errorProps).toEqual(expect.arrayContaining([...expectedProps]));
      }
    });
  });
});
