import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface.js';
import type { JwtPayload } from '../interfaces/jwt-payload.interface.js';

export function extractCurrentUser(
  field: keyof JwtPayload | undefined,
  context: ExecutionContext,
): JwtPayload | JwtPayload[keyof JwtPayload] | undefined {
  const request = context
    .switchToHttp()
    .getRequest<Partial<AuthenticatedRequest>>();
  const user = request.user;
  return field ? user?.[field] : user;
}

export const CurrentUser = createParamDecorator(
  (field: keyof JwtPayload | undefined, context: ExecutionContext) =>
    extractCurrentUser(field, context),
);

