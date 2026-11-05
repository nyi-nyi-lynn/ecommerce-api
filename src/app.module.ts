import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { StockModule } from './stock/stock.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { CartModule } from './cart/cart.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { validateEnvironment } from './auth/token-config.js';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/http/global-exception.filter.js';
import { ResponseInterceptor } from './common/http/response.interceptor.js';

// The interceptor wraps ordinary JSON data; the filter formats thrown errors.
// Both are registered here once so every HTTP module uses the same contract.

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    StockModule,
    RbacModule,
    OrdersModule,
    CartModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
