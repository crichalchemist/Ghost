const assert = require('node:assert/strict');
const crypto = require('crypto');

describe('Onion Address Generator', function () {
    let onionAddress;

    before(function () {
        onionAddress = require('../../../../../core/server/services/subscriber-provisioning/onion-address');
    });

    describe('generateOnionAddress', function () {
        it('should return an object with onionAddress, publicKey, secretKey, and hostname', function () {
            const result = onionAddress.generate();

            assert.ok(result.onionAddress, 'should have onionAddress');
            assert.ok(result.publicKey, 'should have publicKey (Buffer)');
            assert.ok(result.secretKey, 'should have secretKey (Buffer)');
            assert.ok(result.hostname, 'should have hostname');
        });

        it('should generate a 56-character base32 onion address', function () {
            const result = onionAddress.generate();

            // v3 onion addresses are exactly 56 characters (lowercase base32)
            assert.equal(result.onionAddress.length, 56);
            assert.match(result.onionAddress, /^[a-z2-7]{56}$/);
        });

        it('should generate hostname as onionAddress + .onion', function () {
            const result = onionAddress.generate();

            assert.equal(result.hostname, result.onionAddress + '.onion');
        });

        it('should generate unique addresses on each call', function () {
            const result1 = onionAddress.generate();
            const result2 = onionAddress.generate();

            assert.notEqual(result1.onionAddress, result2.onionAddress);
        });

        it('should produce a 32-byte public key', function () {
            const result = onionAddress.generate();

            assert.ok(Buffer.isBuffer(result.publicKey));
            assert.equal(result.publicKey.length, 32);
        });

        it('should produce a 64-byte expanded secret key', function () {
            const result = onionAddress.generate();

            assert.ok(Buffer.isBuffer(result.secretKey));
            assert.equal(result.secretKey.length, 64);
        });

        it('should derive the same onion address from the same public key', function () {
            const result = onionAddress.generate();
            const derived = onionAddress.deriveOnionAddress(result.publicKey);

            assert.equal(derived, result.onionAddress);
        });
    });

    describe('formatTorKeys', function () {
        it('should format secret key with Tor v3 header', function () {
            const result = onionAddress.generate();
            const formatted = onionAddress.formatSecretKey(result.secretKey);

            assert.ok(Buffer.isBuffer(formatted));
            // Header: "== ed25519v1-secret: type0\x00\x00\x00" (32 bytes) + 64-byte key = 96 bytes
            assert.equal(formatted.length, 96);

            // Check header
            const header = formatted.subarray(0, 29).toString('ascii');
            assert.equal(header, '== ed25519v1-secret: type0\x00\x00\x00');
        });

        it('should format public key with Tor v3 header', function () {
            const result = onionAddress.generate();
            const formatted = onionAddress.formatPublicKey(result.publicKey);

            assert.ok(Buffer.isBuffer(formatted));
            // Header: "== ed25519v1-public: type0\x00\x00\x00" (32 bytes) + 32-byte key = 64 bytes
            assert.equal(formatted.length, 64);

            // Check header
            const header = formatted.subarray(0, 29).toString('ascii');
            assert.equal(header, '== ed25519v1-public: type0\x00\x00\x00');
        });
    });

    describe('deriveOnionAddress', function () {
        it('should reject invalid public key length', function () {
            assert.throws(
                () => onionAddress.deriveOnionAddress(Buffer.alloc(16)),
                /public key must be 32 bytes/
            );
        });

        it('should produce consistent results for same input', function () {
            const pubkey = crypto.randomBytes(32);
            const addr1 = onionAddress.deriveOnionAddress(pubkey);
            const addr2 = onionAddress.deriveOnionAddress(pubkey);

            assert.equal(addr1, addr2);
        });
    });
});
