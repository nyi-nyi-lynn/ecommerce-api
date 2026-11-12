import { Transform } from 'class-transformer';

export function transformBooleanValue(value: unknown): unknown {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
}

export function TransformBoolean(): PropertyDecorator {
  return Transform(({ value }) => transformBooleanValue(value));
}
