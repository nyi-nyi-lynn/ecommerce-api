import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AddCartItemDto } from './dto/add-cart-item.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { CartService } from './cart.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiDocumentEndpoint } from '../common/swagger/swagger.decorators.js';

@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiTags('Cart')
@ApiBearerAuth()
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiDocumentEndpoint({
    summary: 'Get current cart',
    description:
      'Returns the authenticated customer’s cart. Prices are informational current product prices; reading an empty cart does not create one.',
    errors: [401, 500],
  })
  getCart(@CurrentUser('sub') userId: number) {
    return this.cart.getCart(userId);
  }

  @Post('items')
  @ApiDocumentEndpoint({
    summary: 'Add cart item',
    description:
      'Adds a product or atomically increments its existing quantity. Inactive products are rejected; cart operations do not reserve stock.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 500],
  })
  addItem(
    @CurrentUser('sub') userId: number,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cart.addItem(userId, dto);
  }

  @Patch('items/:productId')
  @ApiDocumentEndpoint({
    summary: 'Set cart item quantity',
    description:
      'Sets an exact positive quantity for an item in the authenticated customer’s cart.',
    errors: [400, 401, 404, 409, 500],
  })
  updateItem(
    @CurrentUser('sub') userId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(userId, productId, dto);
  }

  @Delete('items/:productId')
  @ApiDocumentEndpoint({
    summary: 'Remove cart item',
    description: 'Removes an item from the authenticated customer’s cart.',
    errors: [400, 401, 404, 500],
  })
  removeItem(
    @CurrentUser('sub') userId: number,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.cart.removeItem(userId, productId);
  }

  @Delete()
  @ApiDocumentEndpoint({
    summary: 'Clear cart',
    description:
      'Removes all items while retaining the authenticated customer’s cart.',
    errors: [401, 500],
  })
  clearCart(@CurrentUser('sub') userId: number) {
    return this.cart.clearCart(userId);
  }
}
