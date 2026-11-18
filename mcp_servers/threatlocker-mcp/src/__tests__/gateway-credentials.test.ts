import { describe, it, expect, beforeEach } from 'vitest';
import { credentialsStorage, getCredentials } from '../utils/client.js';

beforeEach(() => {
  delete process.env.THREATLOCKER_API_KEY;
  delete process.env.THREATLOCKER_ORGANIZATION_ID;
});

describe('gateway per-request credentials', () => {
  it('request B without headers does not see request A credentials', async () => {
    await credentialsStorage.run({ apiKey: 'key-a', organizationId: 'org-a' }, async () => {
      await Promise.resolve();
      expect(getCredentials()).toMatchObject({ apiKey: 'key-a', organizationId: 'org-a' });
    });
    // Request B: no headers, so no ALS context
    expect(getCredentials()).toBeNull();
    expect(process.env.THREATLOCKER_API_KEY).toBeUndefined();
  });

  it('concurrent requests keep their own keys', async () => {
    const read = (apiKey: string) =>
      credentialsStorage.run({ apiKey, organizationId: 'o' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCredentials()?.apiKey;
      });
    expect(await Promise.all([read('a'), read('b')])).toEqual(['a', 'b']);
  });
});
