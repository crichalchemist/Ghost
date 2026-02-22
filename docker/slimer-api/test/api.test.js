const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Slimer API', function () {
    let createApp;
    let tmpDir;
    let torrcPath;
    let hiddenServicesDir;
    let server;
    let baseUrl;

    const AUTH_SECRET = 'test-secret-token';

    before(function () {
        createApp = require('../lib/app');
    });

    beforeEach(function (done) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slimer-api-test-'));
        torrcPath = path.join(tmpDir, 'torrc');
        hiddenServicesDir = path.join(tmpDir, 'hidden-services');
        fs.mkdirSync(hiddenServicesDir);
        fs.writeFileSync(torrcPath, 'SocksPort 9050\n');

        const app = createApp({
            torrcPath,
            hiddenServicesDir,
            authSecret: AUTH_SECRET,
            signalTor: false  // Don't actually send SIGHUP in tests
        });

        server = http.createServer(app);
        server.listen(0, function () {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            done();
        });
    });

    afterEach(function (done) {
        fs.rmSync(tmpDir, {recursive: true, force: true});
        server.close(done);
    });

    function request(method, urlPath, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const opts = {
                method,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                headers: {
                    'Authorization': `Bearer ${AUTH_SECRET}`,
                    'Content-Type': 'application/json'
                }
            };

            const req = http.request(opts, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve({status: res.statusCode, body: JSON.parse(data)});
                    } catch {
                        resolve({status: res.statusCode, body: data});
                    }
                });
            });

            req.on('error', reject);
            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    function requestNoAuth(method, urlPath) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const opts = {
                method,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname
            };

            const req = http.request(opts, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve({status: res.statusCode, body: JSON.parse(data)});
                    } catch {
                        resolve({status: res.statusCode, body: data});
                    }
                });
            });

            req.on('error', reject);
            req.end();
        });
    }

    describe('Authentication', function () {
        it('should reject requests without auth header', async function () {
            const res = await requestNoAuth('GET', '/hidden-services/test/status');
            assert.equal(res.status, 401);
        });

        it('should reject requests with wrong secret', async function () {
            const res = await new Promise((resolve, reject) => {
                const url = new URL('/hidden-services/test/status', baseUrl);
                const opts = {
                    method: 'GET',
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    headers: {'Authorization': 'Bearer wrong-secret'}
                };
                const req = http.request(opts, (r) => {
                    let data = '';
                    r.on('data', (chunk) => { data += chunk; });
                    r.on('end', () => {
                        try {
                            resolve({status: r.statusCode, body: JSON.parse(data)});
                        } catch {
                            resolve({status: r.statusCode, body: data});
                        }
                    });
                });
                req.on('error', reject);
                req.end();
            });
            assert.equal(res.status, 401);
        });
    });

    describe('POST /hidden-services', function () {
        it('should create a new hidden service', async function () {
            // Use onion-address module to generate real key material
            const onionAddress = require('../../../ghost/core/core/server/services/subscriber-provisioning/onion-address');
            const keys = onionAddress.generate();

            const res = await request('POST', '/hidden-services', {
                username: 'alice',
                target: '10.0.0.4:2368',
                publicKey: onionAddress.formatPublicKey(keys.publicKey).toString('base64'),
                secretKey: onionAddress.formatSecretKey(keys.secretKey).toString('base64'),
                hostname: keys.hostname
            });

            assert.equal(res.status, 201);
            assert.equal(res.body.username, 'alice');
            assert.equal(res.body.hostname, keys.hostname);

            // Verify torrc was updated
            const torrc = fs.readFileSync(torrcPath, 'utf8');
            assert.ok(torrc.includes('ghost-sub-alice'));
            assert.ok(torrc.includes('10.0.0.4:2368'));

            // Verify key files written
            const serviceDir = path.join(hiddenServicesDir, 'ghost-sub-alice');
            assert.ok(fs.existsSync(path.join(serviceDir, 'hs_ed25519_public_key')));
            assert.ok(fs.existsSync(path.join(serviceDir, 'hs_ed25519_secret_key')));
            assert.ok(fs.existsSync(path.join(serviceDir, 'hostname')));
        });

        it('should reject missing required fields', async function () {
            const res = await request('POST', '/hidden-services', {
                username: 'alice'
                // missing target, publicKey, secretKey, hostname
            });

            assert.equal(res.status, 400);
        });

        it('should reject duplicate username', async function () {
            const onionAddress = require('../../../ghost/core/core/server/services/subscriber-provisioning/onion-address');
            const keys = onionAddress.generate();
            const body = {
                username: 'alice',
                target: '10.0.0.4:2368',
                publicKey: onionAddress.formatPublicKey(keys.publicKey).toString('base64'),
                secretKey: onionAddress.formatSecretKey(keys.secretKey).toString('base64'),
                hostname: keys.hostname
            };

            await request('POST', '/hidden-services', body);
            const res = await request('POST', '/hidden-services', body);

            assert.equal(res.status, 409);
        });

        it('should sanitize username to prevent path traversal', async function () {
            const res = await request('POST', '/hidden-services', {
                username: '../../../etc/passwd',
                target: '10.0.0.4:2368',
                publicKey: 'AAAA',
                secretKey: 'BBBB',
                hostname: 'test.onion'
            });

            assert.equal(res.status, 400);
        });
    });

    describe('DELETE /hidden-services/:username', function () {
        it('should remove an existing hidden service', async function () {
            const onionAddress = require('../../../ghost/core/core/server/services/subscriber-provisioning/onion-address');
            const keys = onionAddress.generate();

            // First create the service
            await request('POST', '/hidden-services', {
                username: 'alice',
                target: '10.0.0.4:2368',
                publicKey: onionAddress.formatPublicKey(keys.publicKey).toString('base64'),
                secretKey: onionAddress.formatSecretKey(keys.secretKey).toString('base64'),
                hostname: keys.hostname
            });

            // Then delete it
            const res = await request('DELETE', '/hidden-services/alice');

            assert.equal(res.status, 200);

            // Verify torrc cleaned up
            const torrc = fs.readFileSync(torrcPath, 'utf8');
            assert.ok(!torrc.includes('ghost-sub-alice'));

            // Verify directory removed
            assert.ok(!fs.existsSync(path.join(hiddenServicesDir, 'ghost-sub-alice')));
        });

        it('should return 404 for non-existent service', async function () {
            const res = await request('DELETE', '/hidden-services/nonexistent');
            assert.equal(res.status, 404);
        });
    });

    describe('GET /hidden-services/:username/status', function () {
        it('should return status of existing service', async function () {
            const onionAddress = require('../../../ghost/core/core/server/services/subscriber-provisioning/onion-address');
            const keys = onionAddress.generate();

            await request('POST', '/hidden-services', {
                username: 'alice',
                target: '10.0.0.4:2368',
                publicKey: onionAddress.formatPublicKey(keys.publicKey).toString('base64'),
                secretKey: onionAddress.formatSecretKey(keys.secretKey).toString('base64'),
                hostname: keys.hostname
            });

            const res = await request('GET', '/hidden-services/alice/status');

            assert.equal(res.status, 200);
            assert.equal(res.body.exists, true);
            assert.equal(res.body.configured, true);
            assert.equal(res.body.hostname, keys.hostname);
        });

        it('should return not-found for missing service', async function () {
            const res = await request('GET', '/hidden-services/nonexistent/status');

            assert.equal(res.status, 200);
            assert.equal(res.body.exists, false);
        });
    });

    describe('GET /health', function () {
        it('should return ok', async function () {
            const res = await request('GET', '/health');
            assert.equal(res.status, 200);
            assert.equal(res.body.status, 'ok');
        });
    });
});
