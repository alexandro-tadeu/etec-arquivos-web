'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  POLICY_BOUNDS,validateBootstrapPolicy,randomBootstrapCode,keyedDigest,verifyDigest,
  generateTotpSecret,totpAt,verifyTotp,encryptTotpSecret,decryptTotpSecret,generateRecoveryCodes
} = require('../v3/security');

const digestKey = crypto.randomBytes(32).toString('hex');
const encryptionKey = crypto.randomBytes(32).toString('hex');

test('policy rejects invalid and unsafe bootstrap parameters', () => {
  assert.deepEqual(validateBootstrapPolicy({ttlSeconds:600,maxAttempts:3}),{ttlSeconds:600,maxAttempts:3});
  for (const p of [{ttlSeconds:0,maxAttempts:3},{ttlSeconds:POLICY_BOUNDS.maxTtlSeconds+1,maxAttempts:3},
    {ttlSeconds:600,maxAttempts:0},{ttlSeconds:600,maxAttempts:10},
    {ttlSeconds:'600',maxAttempts:3}]) {
    assert.throws(()=>validateBootstrapPolicy(p));
  }
});

test('bootstrap token is random and checked via keyed digest', () => {
  const one = randomBootstrapCode(), two = randomBootstrapCode();
  assert.notEqual(one,two);
  assert.ok(one.length>=42);
  const digest = keyedDigest(one,digestKey,'bootstrap');
  assert.equal(verifyDigest(one,digest,digestKey,'bootstrap'),true);
  assert.equal(verifyDigest(two,digest,digestKey,'bootstrap'),false);
  assert.equal(verifyDigest(one,digest,digestKey,'recovery'),false);
});

test('TOTP follows RFC 6238 SHA1 test vector truncated to six digits', () => {
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpAt(secret,Math.floor(59000/30000)),'287082');
  assert.equal(verifyTotp(secret,'287082',{at:59000,window:0}),1);
  assert.equal(verifyTotp(secret,'287082',{at:59000,window:0,lastAcceptedCounter:1}),null);
});

test('TOTP enrollment encryption binds secret to administrative identity', () => {
  const secret=generateTotpSecret();
  assert.match(secret,/^[A-Z2-7]+$/);
  const encrypted=encryptTotpSecret(secret,encryptionKey,'admin-a');
  assert.notEqual(encrypted,secret);
  assert.equal(decryptTotpSecret(encrypted,encryptionKey,'admin-a'),secret);
  assert.throws(()=>decryptTotpSecret(encrypted,encryptionKey,'admin-b'));
  assert.throws(()=>decryptTotpSecret(encrypted,crypto.randomBytes(32).toString('hex'),'admin-a'));
});

test('recovery codes are unique and never identical across generations', () => {
  const codes=generateRecoveryCodes();
  assert.equal(codes.length,8);
  assert.equal(new Set(codes).size,8);
  assert.equal(verifyDigest(codes[0],keyedDigest(codes[0],digestKey,'recovery'),digestKey,'recovery'),true);
  assert.throws(()=>generateRecoveryCodes(100));
});
