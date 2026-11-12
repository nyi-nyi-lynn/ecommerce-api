import { Transform } from 'class-transformer';
import {
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export function TransformCmsJsonObject(): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  });
}

export function TransformCmsBoolean(): PropertyDecorator {
  return Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  });
}

export function TransformCmsNullableString(): PropertyDecorator {
  return Transform(({ value }) => {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'string') return value;
    const normalized = value.trim();
    return normalized === '' || normalized.toLowerCase() === 'null'
      ? null
      : normalized;
  });
}

export function isCmsJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (entry: unknown, depth: number): boolean => {
    nodes++;
    if (nodes > 10_000 || depth > 50) return false;
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean'
    )
      return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry !== 'object') return false;
    if (seen.has(entry)) return false;
    const prototype = Object.getPrototypeOf(entry);
    if (
      !Array.isArray(entry) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return false;
    }
    seen.add(entry);
    const valid = Array.isArray(entry)
      ? entry.every((item) => visit(item, depth + 1))
      : Object.values(entry).every((item) => visit(item, depth + 1));
    seen.delete(entry);
    return valid;
  };
  return visit(value, 0);
}

@ValidatorConstraint({ name: 'isCmsJsonObject', async: false })
export class IsCmsJsonObjectConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCmsJsonObject(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'content must be a JSON object with valid JSON values.';
  }
}
