import { describe, expect, it } from 'vitest';
import { getEnabledAuthProviders } from '@/lib/auth-providers';

describe('getEnabledAuthProviders (§11.1: X may ship disabled; WS25-T1: so may Google)', () => {
  it('always includes email, and neither oauth provider when unconfigured', () => {
    expect(getEnabledAuthProviders({})).toEqual(['email']);
  });

  it('includes google only when both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set', () => {
    expect(getEnabledAuthProviders({ AUTH_GOOGLE_ID: 'id' })).toEqual(['email']);
    expect(getEnabledAuthProviders({ AUTH_GOOGLE_SECRET: 'secret' })).toEqual(['email']);
    expect(
      getEnabledAuthProviders({ AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 'secret' }),
    ).toEqual(['email', 'google']);
  });

  it('includes x only when both AUTH_TWITTER_ID and AUTH_TWITTER_SECRET are set', () => {
    expect(getEnabledAuthProviders({ AUTH_TWITTER_ID: 'id' })).toEqual(['email']);
    expect(getEnabledAuthProviders({ AUTH_TWITTER_SECRET: 'secret' })).toEqual(['email']);
    expect(
      getEnabledAuthProviders({ AUTH_TWITTER_ID: 'id', AUTH_TWITTER_SECRET: 'secret' }),
    ).toEqual(['email', 'x']);
  });

  it('includes both google and x when all four credentials are configured', () => {
    expect(
      getEnabledAuthProviders({
        AUTH_GOOGLE_ID: 'gid',
        AUTH_GOOGLE_SECRET: 'gsecret',
        AUTH_TWITTER_ID: 'xid',
        AUTH_TWITTER_SECRET: 'xsecret',
      }),
    ).toEqual(['email', 'google', 'x']);
  });
});
