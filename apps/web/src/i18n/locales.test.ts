import { describe, expect, test } from 'vitest';
import { isLocale, resolveLocale } from './locales';

describe('resolveLocale', () => {
  test('defaults to Catalan with no query and nothing stored', () => {
    expect(resolveLocale('', null)).toBe('ca');
  });

  test('ignores unrelated query parameters', () => {
    expect(resolveLocale('?automation', null)).toBe('ca');
  });

  test('takes the remembered choice when the URL has none', () => {
    expect(resolveLocale('', 'en')).toBe('en');
  });

  test('lets ?lang= override the remembered choice', () => {
    expect(resolveLocale('?lang=ca', 'en')).toBe('ca');
    expect(resolveLocale('?automation&lang=en', 'ca')).toBe('en');
  });

  test('normalizes case and whitespace in ?lang=', () => {
    expect(resolveLocale('?lang=%20EN%20', null)).toBe('en');
  });

  test('falls through an unsupported ?lang= to the remembered choice', () => {
    expect(resolveLocale('?lang=es', 'en')).toBe('en');
    expect(resolveLocale('?lang=', 'en')).toBe('en');
  });

  test('ignores an unsupported stored value', () => {
    expect(resolveLocale('', 'fr')).toBe('ca');
    expect(resolveLocale('', '<script>')).toBe('ca');
  });
});

describe('isLocale', () => {
  test('accepts only the supported languages', () => {
    expect(isLocale('ca')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('CA')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
