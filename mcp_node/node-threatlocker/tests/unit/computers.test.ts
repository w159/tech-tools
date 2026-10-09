import { describe, it, expect } from 'vitest';
import { ThreatLockerClient } from '../../src/index.js';

describe('ComputersResource', () => {
  const client = new ThreatLockerClient({
    apiKey: 'test-api-key',
  });

  it('should list computers', async () => {
    const result = await client.computers.list();

    expect(result).toBeDefined();
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 1,
      name: 'WORKSTATION-01',
      domain: 'corp.local',
      organizationId: 1,
    });
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
  });

  it('should get a specific computer', async () => {
    const computer = await client.computers.get(1);

    expect(computer).toMatchObject({
      id: 1,
      name: 'WORKSTATION-01',
      domain: 'corp.local',
      organizationId: 1,
    });
  });

  it('should get computer checkins', async () => {
    const result = await client.computers.getCheckins({ computerId: '1' });

    expect(result).toBeDefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 1,
      computerId: 1,
      status: 'online',
    });
  });
});