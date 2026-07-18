import { describe, expect, it } from 'vitest';
import { getEnabledAuthProviders } from '@/lib/auth-providers';

describe('getEnabledAuthProviders (§11.1: X may ship disabled)', () => {
  it('always includes google and email', () => {
    expect(getEnabledAuthProviders({})).toEqual(['google', 'email']);
  });

  it('includes x only when both AUTH_TWITTER_ID and AUTH_TWITTER_SECRET are set', () => {
    expect(getEnabledAuthProviders({ AUTH_TWITTER_ID: 'id' })).toEqual(['google', 'email']);
    expect(getEnabledAuthProviders({ AUTH_TWITTER_SECRET: 'secret' })).toEqual(['google', 'email']);
    expect(
      getEnabledAuthProviders({ AUTH_TWITTER_ID: 'id', AUTH_TWITTER_SECRET: 'secret' }),
    ).toEqual(['google', 'email', 'x']);
  });
});
