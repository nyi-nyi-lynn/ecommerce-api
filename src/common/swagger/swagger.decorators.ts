import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  type ApiResponseOptions,
} from '@nestjs/swagger';

type DocumentEndpointOptions = {
  summary: string;
  description: string;
  successStatus?: 200 | 201 | 204;
  errors?: number[];
  successExample?: unknown;
};

const successSchema = {
  type: 'object',
  required: ['success', 'data', 'timestamp', 'path'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {},
    timestamp: {
      type: 'string',
      format: 'date-time',
      example: '2026-10-30T08:00:00.000Z',
    },
    path: { type: 'string', example: '/api/example' },
  },
};

const errorSchema = {
  type: 'object',
  required: ['success', 'statusCode', 'message', 'error', 'timestamp', 'path'],
  properties: {
    success: { type: 'boolean', example: false },
    statusCode: { type: 'integer', example: 400 },
    message: {
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      example: 'Request validation failed.',
    },
    error: { type: 'string', example: 'Bad Request' },
    timestamp: {
      type: 'string',
      format: 'date-time',
      example: '2026-10-30T08:00:00.000Z',
    },
    path: { type: 'string', example: '/api/example' },
  },
};

const statusDescriptions: Record<number, string> = {
  400: 'Invalid request or validation error.',
  401: 'Authentication is missing or invalid.',
  403: 'The authenticated user lacks the required permission.',
  404: 'The requested resource was not found.',
  409: 'The request conflicts with the current resource state.',
  422: 'The request is well-formed but cannot be processed.',
  429: 'Too many requests. Please try again later.',
  500: 'Internal server error',
};

/** Documents the application's global success/error envelope for one route. */
export function ApiDocumentEndpoint(options: DocumentEndpointOptions) {
  const successStatus = options.successStatus ?? 200;
  const responses: ApiResponseOptions[] = [
    {
      status: successStatus,
      description:
        successStatus === 204
          ? 'Operation completed without a response body.'
          : 'Successful response using the global API envelope.',
      ...(successStatus !== 204 && {
        schema: successSchema,
        example: {
          success: true,
          data: options.successExample ?? {},
          timestamp: '2026-10-30T08:00:00.000Z',
          path: '/api/example',
        },
      }),
    },
    ...(options.errors ?? []).map((status) => ({
      status,
      description: statusDescriptions[status] ?? 'Request failed.',
      schema: errorSchema,
      example: {
        success: false,
        statusCode: status,
        message: statusDescriptions[status] ?? 'Request failed.',
        error:
          (
            {
              400: 'Bad Request',
              401: 'Unauthorized',
              403: 'Forbidden',
              404: 'Not Found',
              409: 'Conflict',
              422: 'Unprocessable Entity',
              429: 'Too Many Requests',
              500: 'Internal Server Error',
            } as Record<number, string>
          )[status] ?? 'Error',
        timestamp: '2026-10-30T08:00:00.000Z',
        path: '/api/example',
      },
    })),
  ];

  return applyDecorators(
    ApiOperation({
      summary: options.summary,
      description: options.description,
    }),
    ...responses.map((response) => ApiResponse(response)),
  );
}

export const DYNAMIC_RBAC_DESCRIPTION =
  'Authorization is checked against the current database-backed permissions for the authenticated user. JWT role claims are not the authorization source of truth.';
