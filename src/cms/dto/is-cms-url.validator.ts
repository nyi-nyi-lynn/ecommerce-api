import {
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isCmsUrl', async: false })
export class IsCmsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string') return false;
    if (value.startsWith('/') && !value.startsWith('//')) return true;
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return true;
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'url must be an HTTP(S), mailto, or root-relative URL.';
  }
}
