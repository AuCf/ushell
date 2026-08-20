import { describe, expect, it } from 'vitest';
import { stripServerSecrets } from './credentialService';

describe('stripServerSecrets', () => {
  it('never serializes passwords or private keys', () => {
    const profile = stripServerSecrets({
      id: 'srv_1', name: 'server', host: 'example.com', port: 22, username: 'root',
      authType: 'password', password: 'secret', privateKey: 'private', createdAt: 1
    });
    expect(profile).not.toHaveProperty('password');
    expect(profile).not.toHaveProperty('privateKey');
  });
});
