import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AddCartItemDto } from './dto/add-cart-item.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { CartService } from './cart.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiDocumentEndpoint } from '../common/swagger/swagger.decorators.js';

type AuthenticatedRequest = Request & { user: { sub: number } };

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
  getCart(@Req() request: AuthenticatedRequest) {
    return this.cart.getCart(request.user.sub);
  }

  @Post('items')
  @ApiDocumentEndpoint({
    summary: 'Add cart item',
    description:
      'Adds a product or atomically increments its existing quantity. Inactive products are rejected; cart operations do not reserve stock.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 500],
  })
  addItem(@Req() request: AuthenticatedRequest, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(request.user.sub, dto);
  }

  @Patch('items/:productId')
  @ApiDocumentEndpoint({
    summary: 'Set cart item quantity',
    description:
      'Sets an exact positive quantity for an item in the authenticated customer’s cart.',
    errors: [400, 401, 404, 409, 500],
  })
  updateItem(
    @Req() request: AuthenticatedRequest,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(request.user.sub, productId, dto);
  }

  @Delete('items/:productId')
  @ApiDocumentEndpoint({
    summary: 'Remove cart item',
    description: 'Removes an item from the authenticated customer’s cart.',
    errors: [400, 401, 404, 500],
  })
  removeItem(
    @Req() request: AuthenticatedRequest,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.cart.removeItem(request.user.sub, productId);
  }

  @Delete()
  @ApiDocumentEndpoint({
    summary: 'Clear cart',
    description:
      'Removes all items while retaining the authenticated customer’s cart.',
    errors: [401, 500],
  })
  clearCart(@Req() request: AuthenticatedRequest) {
    return this.cart.clearCart(request.user.sub);
  }
}
