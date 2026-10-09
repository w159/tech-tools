import { describe, it, expect } from 'vitest';
import { unwrapPaginatedResponse } from '../../src/pagination.js';

describe('unwrapPaginatedResponse', () => {
  it('unwraps the bare array the PortalAPI GetByParameters endpoints return, total from totalRows', () => {
    const rows = [
      { computerId: 'a', totalRows: 148 },
      { computerId: 'b', totalRows: 148 },
    ];
    const page = unwrapPaginatedResponse<typeof rows[number]>(rows, 1, 2);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(148);
    expect(page.hasMore).toBe(true);
  });

  it('falls back to the array length when rows carry no totalRows', () => {
    const page = unwrapPaginatedResponse<{ id: number }>([{ id: 1 }], 1, 25);
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it('still unwraps an enveloped page', () => {
    const page = unwrapPaginatedResponse<{ id: number }>({ items: [{ id: 1 }], totalItems: 30 }, 1, 25);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(30);
    expect(page.hasMore).toBe(true);
  });
});
