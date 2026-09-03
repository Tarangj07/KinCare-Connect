import { describe, expect, it } from 'vitest';

import { API_BASE_URL } from './api-base';

describe('API_BASE_URL', () => {
  it('has a default value', () => {
    expect(typeof API_BASE_URL).toBe('string');
    expect(API_BASE_URL.length).toBeGreaterThan(0);
  });
});
