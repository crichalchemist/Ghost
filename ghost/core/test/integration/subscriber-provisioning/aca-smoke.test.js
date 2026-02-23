const assert = require('node:assert/strict');
const sinon = require('sinon');
const crypto = require('crypto');

/**
 * ACA Subscriber Provisioning Smoke Tests
 *
 * Tests the complete subscriber lifecycle through AcaManager:
 *   create → verify state → custom domain → delete → verify cleanup
 *
 * Uses fully stubbed Azure SDK clients (no real Azure calls).
 * For real Azure E2E, run with AZURE_LIVE_TEST=true and valid credentials.
 */
describe('ACA Subscriber Provisioning - Smoke Test', function () {
    let AcaManager;
    let containerAppsClient;
    let shareServiceClient;
    let knexStub;
    let subscribers;
    let events;

    beforeEach(function () {
        // In-memory database stores
        subscribers = new Map();
        events = [];

        // Knex stub
        knexStub = function (tableName) {
            if (tableName === 'subscribers') {
                return {
                    insert: sinon.stub().callsFake(async (data) => {
                        subscribers.set(data.id, data);
                    }),
                    where: sinon.stub().callsFake((key, value) => {
                        return {
                            first: sinon.stub().callsFake(async () => {
                                for (const sub of subscribers.values()) {
                                    if (sub[key] === value) {
                                        return sub;
                                    }
                                }
                                return null;
                            }),
                            update: sinon.stub().callsFake(async (data) => {
                                for (const [id, sub] of subscribers.entries()) {
                                    if (sub[key] === value) {
                                        subscribers.set(id, {...sub, ...data});
                                    }
                                }
                            }),
                            delete: sinon.stub().callsFake(async () => {
                                for (const [id, sub] of subscribers.entries()) {
                                    if (sub[key] === value) {
                                        subscribers.delete(id);
                                    }
                                }
                            })
                        };
                    })
                };
            }
            if (tableName === 'subscriber_container_events') {
                return {
                    insert: sinon.stub().callsFake(async (data) => {
                        events.push(data);
                    })
                };
            }
            return {
                insert: sinon.stub().resolves(),
                where: sinon.stub().returnsThis(),
                first: sinon.stub().resolves(null),
                update: sinon.stub().resolves(),
                delete: sinon.stub().resolves()
            };
        };

        // Azure Container Apps client stub
        containerAppsClient = {
            subscriptionId: 'test-sub-id',
            containerApps: {
                beginCreateOrUpdateAndWait: sinon.stub().resolves({
                    configuration: {
                        ingress: {
                            fqdn: 'ghost-sub-alice.livelymeadow-abc123.francecentral.azurecontainerapps.io',
                            customDomains: []
                        }
                    },
                    provisioningState: 'Succeeded'
                }),
                beginDeleteAndWait: sinon.stub().resolves(),
                get: sinon.stub().resolves({
                    configuration: {
                        ingress: {
                            fqdn: 'ghost-sub-alice.livelymeadow-abc123.francecentral.azurecontainerapps.io',
                            customDomains: []
                        }
                    },
                    provisioningState: 'Succeeded',
                    runningStatus: 'Running'
                })
            },
            managedEnvironmentsStorages: {
                createOrUpdate: sinon.stub().resolves(),
                delete: sinon.stub().resolves()
            }
        };

        // Azure Storage client stub
        const fileClient = {
            create: sinon.stub().resolves(),
            uploadRange: sinon.stub().resolves()
        };
        const dirClient = {
            getFileClient: sinon.stub().returns(fileClient)
        };
        const shareClient = {
            create: sinon.stub().resolves(),
            delete: sinon.stub().resolves(),
            getDirectoryClient: sinon.stub().returns(dirClient)
        };
        shareServiceClient = {
            getShareClient: sinon.stub().returns(shareClient)
        };

        AcaManager = require('../../../core/server/services/subscriber-provisioning/aca-manager');
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('Full Subscriber Lifecycle', function () {
        it('create subscriber → verify state → delete → verify cleanup', async function () {
            const slimerClient = {
                createHiddenService: sinon.stub().resolves(),
                removeHiddenService: sinon.stub().resolves()
            };

            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient
            });

            // --- CREATE ---
            const result = await manager.createSubscriberContainer({
                id: 'mem_alice',
                email: 'alice@example.com',
                username: 'alice',
                custom_domain: null,
                onion_enabled: false
            });

            // Verify create result
            assert.ok(result.containerAppName, 'Should return container app name');
            assert.equal(result.containerAppName, 'ghost-sub-alice');
            assert.ok(result.fqdn, 'Should return FQDN');
            assert.equal(result.url, 'https://alice.private-stack.dev');
            assert.ok(result.subscriberId, 'Should return subscriber ID');

            // Verify database state
            assert.equal(subscribers.size, 1);
            const sub = [...subscribers.values()][0];
            assert.equal(sub.username, 'alice');
            assert.equal(sub.status, 'running');
            assert.equal(sub.port, 2368);

            // Verify events logged
            assert.equal(events.length, 1);
            assert.equal(events[0].event_type, 'created');

            // Verify Azure calls
            assert.equal(containerAppsClient.containerApps.beginCreateOrUpdateAndWait.calledOnce, true);
            assert.equal(containerAppsClient.managedEnvironmentsStorages.createOrUpdate.calledOnce, true);
            assert.equal(shareServiceClient.getShareClient.calledOnce, true);

            // --- DELETE ---
            await manager.deleteSubscriberContainer('alice');

            // Verify cleanup
            assert.equal(subscribers.size, 0, 'Subscriber should be removed from DB');
            assert.equal(events.length, 2, 'Delete event should be logged');
            assert.equal(events[1].event_type, 'deleted');

            // Verify Azure cleanup calls
            assert.equal(containerAppsClient.containerApps.beginDeleteAndWait.calledOnce, true);
            assert.equal(containerAppsClient.managedEnvironmentsStorages.delete.calledOnce, true);
        });

        it('create subscriber with onion → verify .onion provisioned → delete → verify cleanup', async function () {
            const slimerClient = {
                createHiddenService: sinon.stub().resolves(),
                removeHiddenService: sinon.stub().resolves()
            };

            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient
            });

            const result = await manager.createSubscriberContainer({
                id: 'mem_bob',
                email: null,
                username: 'bob',
                custom_domain: null,
                onion_enabled: true
            });

            // Verify onion address was provisioned
            assert.ok(result.onionAddress, 'Should return .onion address');
            assert.ok(result.onionAddress.endsWith('.onion'), 'Should be a .onion address');

            // Verify slimer was called
            assert.equal(slimerClient.createHiddenService.calledOnce, true);
            const slimerArgs = slimerClient.createHiddenService.firstCall.args[0];
            assert.equal(slimerArgs.username, 'bob');
            assert.ok(slimerArgs.publicKey, 'Should provide public key');
            assert.ok(slimerArgs.secretKey, 'Should provide secret key');
            assert.ok(slimerArgs.hostname, 'Should provide hostname');

            // Verify onion address stored in DB
            const sub = [...subscribers.values()][0];
            assert.ok(sub.onion_address, 'DB should have onion_address');
            assert.ok(sub.onion_address.endsWith('.onion'));

            // --- DELETE with onion cleanup ---
            await manager.deleteSubscriberContainer('bob');

            assert.equal(slimerClient.removeHiddenService.calledOnce, true);
            assert.equal(slimerClient.removeHiddenService.firstCall.args[0], 'bob');
            assert.equal(subscribers.size, 0);
        });
    });

    describe('Custom Domain Binding', function () {
        it('adds custom domain to existing container', async function () {
            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient: {createHiddenService: sinon.stub(), removeHiddenService: sinon.stub()}
            });

            await manager.addCustomDomain('alice', 'blog.alice.com');

            // Verify Azure was called with domain config
            const updateCall = containerAppsClient.containerApps.beginCreateOrUpdateAndWait;
            assert.equal(updateCall.calledOnce, true);
            const envelope = updateCall.firstCall.args[2];
            const domains = envelope.configuration.ingress.customDomains;
            assert.equal(domains.length, 1);
            assert.equal(domains[0].name, 'blog.alice.com');
        });
    });

    describe('Ghost Config Generation', function () {
        it('generates correct config with tinybird inheritance', async function () {
            // Stub Ghost config to return tinybird settings
            const Module = require('module');
            const originalRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === '../../../shared/config') {
                    return {
                        get: function (key) {
                            if (key === 'tinybird') {
                                return {
                                    workspaceId: 'ws-123',
                                    adminToken: 'admin-tok',
                                    stats: {endpoint: 'http://localhost:7181'}
                                };
                            }
                            return null;
                        }
                    };
                }
                return originalRequire.apply(this, arguments);
            };

            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient: {createHiddenService: sinon.stub(), removeHiddenService: sinon.stub()}
            });

            const config = manager.generateGhostConfig({username: 'testuser', email: 'test@test.com'});

            Module.prototype.require = originalRequire;

            // Verify base config
            assert.equal(config.url, 'https://testuser.private-stack.dev');
            assert.equal(config.port, 2368);
            assert.equal(config.database.client, 'sqlite3');
            assert.ok(config.database.connection.filename.includes('testuser'));

            // Verify tinybird inherited
            assert.ok(config.tinybird, 'Config should include tinybird');
            assert.equal(config.tinybird.workspaceId, 'ws-123');
            assert.equal(config.tinybird.adminToken, 'admin-tok');
        });
    });

    describe('Error Handling', function () {
        it('rejects invalid username', async function () {
            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient: {createHiddenService: sinon.stub(), removeHiddenService: sinon.stub()}
            });

            await assert.rejects(
                () => manager.createSubscriberContainer({
                    id: 'mem_bad',
                    email: 'bad@test.com',
                    username: 'INVALID-UPPERCASE',
                    custom_domain: null
                }),
                /Invalid username/
            );
        });

        it('cleans up on partial failure during creation', async function () {
            // Make container creation fail after file share succeeds
            containerAppsClient.containerApps.beginCreateOrUpdateAndWait
                .rejects(new Error('Azure quota exceeded'));

            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient: {createHiddenService: sinon.stub(), removeHiddenService: sinon.stub()}
            });

            await assert.rejects(
                () => manager.createSubscriberContainer({
                    id: 'mem_fail',
                    email: 'fail@test.com',
                    username: 'failuser',
                    custom_domain: null
                }),
                /Azure quota exceeded/
            );

            // Verify cleanup was attempted
            const shareClient = shareServiceClient.getShareClient('ghost-failuser');
            assert.ok(shareClient.delete.calledOnce, 'File share should be cleaned up');
        });
    });

    describe('Subscriber Status', function () {
        it('queries Azure for container status', async function () {
            const manager = new AcaManager({
                containerAppsClient,
                shareServiceClient,
                getKnex: () => knexStub,
                subscriptionId: 'test-sub-id',
                slimerClient: {createHiddenService: sinon.stub(), removeHiddenService: sinon.stub()}
            });

            const status = await manager.getSubscriberStatus('alice');

            assert.equal(status.provisioningState, 'Succeeded');
            assert.equal(status.runningStatus, 'Running');
        });
    });
});
