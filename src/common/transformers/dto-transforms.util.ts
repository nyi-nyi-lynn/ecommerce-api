import { Transform } from 'class-transformer';

export function transformTrimmedString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function transformNullableString(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') {
      return null;
    }
    return trimmed;
  }
  return value;
}

export function transformOptionalNumber(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return Number.NaN;
    }
    return Number(trimmed);
  }
  return value;
}

export function transformNullableNumber(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') {
      return null;
    }
    return Number(trimmed);
  }
  return value;
}

export function transformUpdateNullableNumber(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === 'null') {
      return null;
    }
    if (trimmed === '') {
      return Number.NaN;
    }
    return Number(trimmed);
  }
  return value;
}

export function transformUpdateNullableUuid(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === 'null') {
      return null;
    }
    return trimmed;
  }
  return value;
}

export function TransformTrimmedString(): PropertyDecorator {
  return Transform(({ value }) => transformTrimmedString(value));
}

export function TransformNullableString(): PropertyDecorator {
  return Transform(({ value }) => transformNullableString(value));
}

export function TransformOptionalNumber(): PropertyDecorator {
  return Transform(({ value }) => transformOptionalNumber(value));
}

export function TransformNullableNumber(): PropertyDecorator {
  return Transform(({ value }) => transformNullableNumber(value));
}

export function TransformUpdateNullableNumber(): PropertyDecorator {
  return Transform(({ value }) => transformUpdateNullableNumber(value));
}

export function TransformUpdateNullableUuid(): PropertyDecorator {
  return Transform(({ value }) => transformUpdateNullableUuid(value));
}
