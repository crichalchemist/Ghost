const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('TorrcManager', function () {
    let TorrcManager;
    let tmpDir;
    let torrcPath;
    let hiddenServicesDir;

    before(function () {
        TorrcManager = require('../lib/torrc-manager');
    });

    beforeEach(function () {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slimer-test-'));
        torrcPath = path.join(tmpDir, 'torrc');
        hiddenServicesDir = path.join(tmpDir, 'hidden-services');
        fs.mkdirSync(hiddenServicesDir);
    });

    afterEach(function () {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    describe('parseTorrc', function () {
        it('should parse existing hidden service entries', function () {
            fs.writeFileSync(torrcPath, [
                '# Tor config',
                'SocksPort 9050',
                '',
                'HiddenServiceDir /var/lib/tor/monerod',
                'HiddenServicePort 18089 127.0.0.1:18089',
                'HiddenServicePort 18084 127.0.0.1:18084',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            const services = manager.parseTorrc();

            assert.equal(services.length, 1);
            assert.equal(services[0].dir, '/var/lib/tor/monerod');
            assert.deepEqual(services[0].ports, [
                {virtual: 18089, target: '127.0.0.1:18089'},
                {virtual: 18084, target: '127.0.0.1:18084'}
            ]);
        });

        it('should parse multiple hidden services', function () {
            fs.writeFileSync(torrcPath, [
                'HiddenServiceDir /var/lib/tor/monerod',
                'HiddenServicePort 18089 127.0.0.1:18089',
                'HiddenServiceDir /var/lib/tor/ghost-sub-alice',
                'HiddenServicePort 80 10.0.0.4:2368',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            const services = manager.parseTorrc();

            assert.equal(services.length, 2);
            assert.equal(services[0].dir, '/var/lib/tor/monerod');
            assert.equal(services[1].dir, '/var/lib/tor/ghost-sub-alice');
        });

        it('should return empty array for torrc with no hidden services', function () {
            fs.writeFileSync(torrcPath, 'SocksPort 9050\n');

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            const services = manager.parseTorrc();

            assert.equal(services.length, 0);
        });
    });

    describe('addHiddenService', function () {
        it('should append hidden service entry to torrc', function () {
            fs.writeFileSync(torrcPath, [
                'SocksPort 9050',
                '',
                'HiddenServiceDir /var/lib/tor/monerod',
                'HiddenServicePort 18089 127.0.0.1:18089',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            manager.addHiddenService('alice', '10.0.0.4:2368');

            const content = fs.readFileSync(torrcPath, 'utf8');
            assert.ok(content.includes(`HiddenServiceDir ${hiddenServicesDir}/ghost-sub-alice`));
            assert.ok(content.includes('HiddenServicePort 80 10.0.0.4:2368'));
        });

        it('should not duplicate an existing service', function () {
            fs.writeFileSync(torrcPath, [
                `HiddenServiceDir ${hiddenServicesDir}/ghost-sub-alice`,
                'HiddenServicePort 80 10.0.0.4:2368',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            assert.throws(
                () => manager.addHiddenService('alice', '10.0.0.4:2368'),
                /already exists/
            );
        });

        it('should create the hidden service directory', function () {
            fs.writeFileSync(torrcPath, 'SocksPort 9050\n');

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            manager.addHiddenService('bob', '10.0.0.4:2368');

            const serviceDir = path.join(hiddenServicesDir, 'ghost-sub-bob');
            assert.ok(fs.existsSync(serviceDir));

            // Tor requires 0700 permissions on hidden service directories
            const stats = fs.statSync(serviceDir);
            assert.equal(stats.mode & 0o777, 0o700);
        });
    });

    describe('removeHiddenService', function () {
        it('should remove hidden service entry from torrc', function () {
            fs.writeFileSync(torrcPath, [
                'SocksPort 9050',
                '',
                'HiddenServiceDir /var/lib/tor/monerod',
                'HiddenServicePort 18089 127.0.0.1:18089',
                '',
                `HiddenServiceDir ${hiddenServicesDir}/ghost-sub-alice`,
                'HiddenServicePort 80 10.0.0.4:2368',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            manager.removeHiddenService('alice');

            const content = fs.readFileSync(torrcPath, 'utf8');
            assert.ok(!content.includes('ghost-sub-alice'));
            // monerod entry should remain
            assert.ok(content.includes('/var/lib/tor/monerod'));
        });

        it('should remove the hidden service directory', function () {
            const serviceDir = path.join(hiddenServicesDir, 'ghost-sub-alice');
            fs.mkdirSync(serviceDir, {mode: 0o700});
            fs.writeFileSync(path.join(serviceDir, 'hostname'), 'test.onion\n');

            fs.writeFileSync(torrcPath, [
                `HiddenServiceDir ${serviceDir}`,
                'HiddenServicePort 80 10.0.0.4:2368',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            manager.removeHiddenService('alice');

            assert.ok(!fs.existsSync(serviceDir));
        });

        it('should throw if service does not exist', function () {
            fs.writeFileSync(torrcPath, 'SocksPort 9050\n');

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            assert.throws(
                () => manager.removeHiddenService('nonexistent'),
                /not found/
            );
        });
    });

    describe('writeKeys', function () {
        it('should write public and secret key files to service directory', function () {
            const serviceDir = path.join(hiddenServicesDir, 'ghost-sub-alice');
            fs.mkdirSync(serviceDir, {mode: 0o700});

            const publicKey = Buffer.alloc(64, 0xAA);  // 64-byte formatted public key
            const secretKey = Buffer.alloc(96, 0xBB);  // 96-byte formatted secret key
            const hostname = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdefgh.onion';

            const manager = new TorrcManager({torrcPath: torrcPath, hiddenServicesDir});
            manager.writeKeys('alice', {publicKey, secretKey, hostname});

            const pubPath = path.join(serviceDir, 'hs_ed25519_public_key');
            const secPath = path.join(serviceDir, 'hs_ed25519_secret_key');
            const hostPath = path.join(serviceDir, 'hostname');

            assert.ok(fs.existsSync(pubPath));
            assert.ok(fs.existsSync(secPath));
            assert.ok(fs.existsSync(hostPath));

            assert.deepEqual(fs.readFileSync(pubPath), publicKey);
            assert.deepEqual(fs.readFileSync(secPath), secretKey);
            assert.equal(fs.readFileSync(hostPath, 'utf8'), hostname + '\n');
        });
    });

    describe('getServiceStatus', function () {
        it('should return status for existing service', function () {
            const serviceDir = path.join(hiddenServicesDir, 'ghost-sub-alice');
            fs.mkdirSync(serviceDir, {mode: 0o700});
            fs.writeFileSync(path.join(serviceDir, 'hostname'), 'test1234567890abcdef1234567890abcdef1234567890abcdefgh.onion\n');

            fs.writeFileSync(torrcPath, [
                `HiddenServiceDir ${serviceDir}`,
                'HiddenServicePort 80 10.0.0.4:2368',
                ''
            ].join('\n'));

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            const status = manager.getServiceStatus('alice');

            assert.equal(status.exists, true);
            assert.equal(status.hostname, 'test1234567890abcdef1234567890abcdef1234567890abcdefgh.onion');
            assert.equal(status.configured, true);
        });

        it('should return not-exists for missing service', function () {
            fs.writeFileSync(torrcPath, 'SocksPort 9050\n');

            const manager = new TorrcManager({torrcPath, hiddenServicesDir});
            const status = manager.getServiceStatus('nonexistent');

            assert.equal(status.exists, false);
            assert.equal(status.configured, false);
        });
    });
});
