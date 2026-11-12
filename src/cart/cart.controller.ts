import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AddCartItemDto } from './dto/add-cart-item.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { CartService } from './cart.service.js';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import { ApiDocumentEndpoint } from '../common/swagger/swagger.decorators.js';

@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiTags('Cart')
@ApiBearerAuth()
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Throttle(RATE_LIMIT_POLICIES.CART_READ)
  @ApiDocumentEndpoint({
    summary: 'Get current cart',
    description:
      'Returns the authenticated customer’s cart. Prices are informational current product prices; reading an empty cart does not create one.',
    errors: [401, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          productId: '880e8400-e29b-41d4-a716-446655440003',
          quantity: 2,
          product: {
            id: '880e8400-e29b-41d4-a716-446655440003',
            name: 'Mechanical Keyboard',
            slug: 'mechanical-keyboard',
            price: '129.99',
            isActive: true,
          },
          lineTotal: '259.98',
        },
      ],
      totalItems: 2,
      estimatedSubtotal: '259.98',
    },
  })
  getCart(@CurrentUser('sub') userId: string) {
    return this.cart.getCart(userId);
  }

  @Post('items')
  @Throttle(RATE_LIMIT_POLICIES.CART_MUTATION)
  @ApiDocumentEndpoint({
    summary: 'Add cart item',
    description:
      'Adds a product or atomically increments its existing quantity. Inactive products are rejected; cart operations do not reserve stock.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          productId: '880e8400-e29b-41d4-a716-446655440003',
          quantity: 2,
        },
      ],
    },
  })
  addItem(@CurrentUser('sub') userId: string, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(userId, dto);
  }

  @Patch('items/:productId')
  @Throttle(RATE_LIMIT_POLICIES.CART_MUTATION)
  @ApiParam({
    name: 'productId',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Set cart item quantity',
    description:
      'Sets an exact positive quantity for an item in the authenticated customer’s cart.',
    errors: [400, 401, 404, 409, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          productId: '550e8400-e29b-41d4-a716-446655440000',
          quantity: 3,
        },
      ],
    },
  })
  updateItem(
    @CurrentUser('sub') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(userId, productId, dto);
  }

  @Delete('items/:productId')
  @Throttle(RATE_LIMIT_POLICIES.CART_MUTATION)
  @ApiParam({
    name: 'productId',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Remove cart item',
    description: 'Removes an item from the authenticated customer’s cart.',
    errors: [400, 401, 404, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      items: [],
    },
  })
  removeItem(
    @CurrentUser('sub') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.cart.removeItem(userId, productId);
  }

  @Delete()
  @Throttle(RATE_LIMIT_POLICIES.CART_CLEAR)
  @ApiDocumentEndpoint({
    summary: 'Clear cart',
    description:
      'Removes all items while retaining the authenticated customer’s cart.',
    errors: [401, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      items: [],
    },
  })
  clearCart(@CurrentUser('sub') userId: string) {
    return this.cart.clearCart(userId);
  }
}
