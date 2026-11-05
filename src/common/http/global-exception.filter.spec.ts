import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';
import { GlobalExceptionFilter } from './global-exception.filter.js';

describe('GlobalExceptionFilter (unit)', () => {
  let filter: GlobalExceptionFilter;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ path: '/api/categories' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('formats Multer LIMIT_FILE_SIZE with a generic image size message', () => {
    filter.catch(new MulterError('LIMIT_FILE_SIZE', 'image'), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 413,
        message: 'The uploaded image must be 5 MB or smaller.',
        error: 'Payload Too Large',
        path: '/api/categories',
      }),
    );
  });

  it('formats Multer LIMIT_UNEXPECTED_FILE referencing the "image" field name', () => {
    filter.catch(new MulterError('LIMIT_UNEXPECTED_FILE', 'file'), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        message: 'Use the predictable file field name: image.',
        error: 'Bad Request',
        path: '/api/categories',
      }),
    );
  });

  it('formats other Multer errors with a generic invalid file message', () => {
    filter.catch(new MulterError('LIMIT_FILE_COUNT', 'image'), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        message: 'The uploaded file is invalid.',
        error: 'Bad Request',
        path: '/api/categories',
      }),
    );
  });
});
