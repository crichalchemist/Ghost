const crypto = require('crypto');

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ONION_CHECKSUM_PREFIX = Buffer.from('.onion checksum');
const ONION_VERSION = Buffer.from([0x03]);

/**
 * Base32 encode (RFC 4648, lowercase)
 * @param {Buffer} data
 * @returns {string}
 */
function base32encode(data) {
    let bits = '';
    for (const byte of data) {
        bits += byte.toString(2).padStart(8, '0');
    }
    let result = '';
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.substring(i, i + 5).padEnd(5, '0');
        result += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
    return result;
}

/**
 * Derive a v3 .onion address from a raw 32-byte Ed25519 public key.
 *
 * address = base32(pubkey[32] + checksum[2] + version[1])
 * checksum = SHA3-256(".onion checksum" + pubkey + version)[0:2]
 *
 * @param {Buffer} publicKey - 32-byte raw Ed25519 public key
 * @returns {string} 56-character lowercase base32 onion address (without .onion suffix)
 */
function deriveOnionAddress(publicKey) {
    if (!Buffer.isBuffer(publicKey) || publicKey.length !== 32) {
        throw new Error('public key must be 32 bytes');
    }

    const checksumInput = Buffer.concat([ONION_CHECKSUM_PREFIX, publicKey, ONION_VERSION]);
    const checksum = crypto.createHash('sha3-256').update(checksumInput).digest().subarray(0, 2);
    const addressBytes = Buffer.concat([publicKey, checksum, ONION_VERSION]);

    return base32encode(addressBytes);
}

/**
 * Format a secret key in Tor v3 hidden service format.
 * Output: 32-byte header + 64-byte expanded key = 96 bytes total.
 *
 * @param {Buffer} expandedSecretKey - 64-byte expanded Ed25519 secret key
 * @returns {Buffer} 96-byte Tor v3 formatted secret key file contents
 */
function formatSecretKey(expandedSecretKey) {
    if (!Buffer.isBuffer(expandedSecretKey) || expandedSecretKey.length !== 64) {
        throw new Error('expanded secret key must be 64 bytes');
    }

    // "== ed25519v1-secret: type0" + 3 null bytes = 32 bytes
    const header = Buffer.alloc(32);
    header.write('== ed25519v1-secret: type0', 0, 'ascii');
    return Buffer.concat([header, expandedSecretKey]);
}

/**
 * Format a public key in Tor v3 hidden service format.
 * Output: 32-byte header + 32-byte key = 64 bytes total.
 *
 * @param {Buffer} publicKey - 32-byte raw Ed25519 public key
 * @returns {Buffer} 64-byte Tor v3 formatted public key file contents
 */
function formatPublicKey(publicKey) {
    if (!Buffer.isBuffer(publicKey) || publicKey.length !== 32) {
        throw new Error('public key must be 32 bytes');
    }

    // "== ed25519v1-public: type0" + 3 null bytes = 32 bytes
    const header = Buffer.alloc(32);
    header.write('== ed25519v1-public: type0', 0, 'ascii');
    return Buffer.concat([header, publicKey]);
}

/**
 * Generate a new Tor v3 onion address with key pair.
 *
 * @returns {{onionAddress: string, hostname: string, publicKey: Buffer, secretKey: Buffer}}
 */
function generate() {
    const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: {type: 'spki', format: 'der'},
        privateKeyEncoding: {type: 'pkcs8', format: 'der'}
    });

    // Extract raw 32-byte public key from SPKI DER envelope
    const rawPublicKey = publicKey.subarray(-32);

    // Extract raw 32-byte seed from PKCS8 DER envelope
    const rawSeed = privateKey.subarray(16);

    // Expand seed to 64-byte secret key via SHA-512 (Ed25519 spec)
    const expanded = crypto.createHash('sha512').update(rawSeed).digest();
    expanded[0] &= 248;
    expanded[31] &= 127;
    expanded[31] |= 64;

    const onionAddress = deriveOnionAddress(rawPublicKey);

    return {
        onionAddress,
        hostname: onionAddress + '.onion',
        publicKey: rawPublicKey,
        secretKey: expanded
    };
}

module.exports = {
    generate,
    deriveOnionAddress,
    formatSecretKey,
    formatPublicKey
};
