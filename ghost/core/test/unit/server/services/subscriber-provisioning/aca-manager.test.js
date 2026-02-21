const assert = require('node:assert/strict');
const sinon = require('sinon');

describe('AcaManager', function () {
    let containerAppsClientStub;
    let shareServiceClientStub;
    let knexStub;
    let subscribersInsertStub;
    let eventsInsertStub;
    let AcaManager;

    before(function () {
        AcaManager = require('../../../../../core/server/services/subscriber-provisioning/aca-manager');
    });

    beforeEach(function () {
        containerAppsClientStub = {
            subscriptionId: 'test-sub-id',
            managedEnvironmentsStorages: {
                createOrUpdate: sinon.stub().resolves(),
                delete: sinon.stub().resolves()
            },
            containerApps: {
                beginCreateOrUpdateAndWait: sinon.stub().resolves({
                    name: 'ghost-sub-testuser',
                    provisioningState: 'Succeeded',
                    runningStatus: 'Running',
                    configuration: {
                        ingress: {
                            fqdn: 'ghost-sub-testuser.lemonmoss-13a98d43.francecentral.azurecontainerapps.io'
                        }
                    }
                }),
                beginDeleteAndWait: sinon.stub().resolves(),
                get: sinon.stub().resolves({
                    provisioningState: 'Succeeded',
                    runningStatus: 'Running',
                    configuration: {
                        ingress: {
                            fqdn: 'ghost-sub-testuser.lemonmoss-13a98d43.francecentral.azurecontainerapps.io'
                        }
                    }
                })
            }
        };

        const fileClientStub = {
            create: sinon.stub().resolves(),
            uploadRange: sinon.stub().resolves()
        };
        const dirClientStub = {
            getFileClient: sinon.stub().returns(fileClientStub)
        };
        const shareClientStub = {
            create: sinon.stub().resolves(),
            delete: sinon.stub().resolves(),
            getDirectoryClient: sinon.stub().returns(dirClientStub)
        };
        shareServiceClientStub = {
            getShareClient: sinon.stub().returns(shareClientStub)
        };

        subscribersInsertStub = sinon.stub().resolves();
        eventsInsertStub = sinon.stub().resolves();

        knexStub = function (tableName) {
            if (tableName === 'subscribers') {
                return {
                    insert: subscribersInsertStub,
                    where: sinon.stub().returnsThis(),
                    first: sinon.stub().resolves({id: 'sub_123', container_id: 'ghost-sub-testuser'}),
                    delete: sinon.stub().resolves()
                };
            }
            if (tableName === 'subscriber_container_events') {
                return {insert: eventsInsertStub};
            }
            return {insert: sinon.stub().resolves()};
        };
    });

    afterEach(function () {
        sinon.restore();
    });

    function createManager(overrides = {}) {
        return new AcaManager({
            containerAppsClient: containerAppsClientStub,
            shareServiceClient: shareServiceClientStub,
            getKnex: () => knexStub,
            subscriptionId: 'test-sub-id',
            resourceGroup: 'ghost-platform-rg',
            environmentName: 'privatestack-env',
            storageAccountName: 'privatestackstorage',
            storageAccountKey: 'dGVzdGtleQ==',
            location: 'francecentral',
            domain: 'private-stack.dev',
            ghostImage: 'ghost:5-alpine',
            cpu: 0.5,
            memoryGi: '1Gi',
            ...overrides
        });
    }

    describe('generateGhostConfig', function () {
        it('should generate valid Ghost config for subscriber', function () {
            const manager = createManager();
            const config = manager.generateGhostConfig({
                username: 'testuser',
                email: 'test@example.com'
            });

            assert.equal(config.url, 'https://testuser.private-stack.dev');
            assert.equal(config.port, 2368);
            assert.equal(config.database.client, 'sqlite3');
            assert.ok(config.database.connection.filename.includes('testuser'));
        });

        it('should set privacy.useUpdateCheck to false', function () {
            const manager = createManager();
            const config = manager.generateGhostConfig({username: 'testuser'});
            assert.equal(config.privacy.useUpdateCheck, false);
        });

        it('should use configurable SMTP host and port', function () {
            const manager = createManager({
                smtp: {host: '10.0.1.5', port: 25}
            });
            const config = manager.generateGhostConfig({username: 'testuser'});

            assert.equal(config.mail.options.host, '10.0.1.5');
            assert.equal(config.mail.options.port, 25);
        });

        it('should default SMTP to rentfall private IP (10.0.0.4) on port 587', function () {
            const manager = createManager();
            const config = manager.generateGhostConfig({username: 'testuser'});

            assert.equal(config.mail.options.host, '10.0.0.4');
            assert.equal(config.mail.options.port, 587);
        });
    });

    describe('createSubscriberContainer', function () {
        it('should create Azure File Share for subscriber', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(shareServiceClientStub.getShareClient);
            sinon.assert.calledWith(shareServiceClientStub.getShareClient, 'ghost-testuser');
        });

        it('should upload Ghost config to file share', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            const shareClient = shareServiceClientStub.getShareClient.returnValues[0];
            const dirClient = shareClient.getDirectoryClient.returnValues[0];
            const fileClient = dirClient.getFileClient.returnValues[0];

            sinon.assert.calledOnce(fileClient.create);
            sinon.assert.calledOnce(fileClient.uploadRange);
        });

        it('should create container app with correct configuration', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait);

            const callArgs = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args;
            assert.equal(callArgs[0], 'ghost-platform-rg');
            assert.equal(callArgs[1], 'ghost-sub-testuser');

            const envelope = callArgs[2];
            assert.equal(envelope.location, 'francecentral');
            assert.equal(envelope.template.containers[0].image, 'ghost:5-alpine');
            assert.equal(envelope.template.containers[0].resources.cpu, 0.5);
            assert.equal(envelope.configuration.ingress.external, true);
            assert.equal(envelope.configuration.ingress.targetPort, 2368);
            assert.equal(envelope.template.scale.minReplicas, 1);
            assert.equal(envelope.template.scale.maxReplicas, 1);
        });

        it('should set environment variables on container', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            const envelope = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args[2];
            const envVars = envelope.template.containers[0].env;
            const nodeEnv = envVars.find(e => e.name === 'NODE_ENV');
            const urlEnv = envVars.find(e => e.name === 'url');
            assert.equal(nodeEnv.value, 'production');
            assert.equal(urlEnv.value, 'https://testuser.private-stack.dev');
        });

        it('should mount Azure File Share as volume', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            const envelope = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args[2];
            assert.equal(envelope.template.volumes[0].name, 'ghost-content');
            assert.equal(envelope.template.volumes[0].storageName, 'ghost-testuser');
            assert.equal(envelope.template.volumes[0].storageType, 'AzureFile');
            assert.equal(envelope.template.containers[0].volumeMounts[0].mountPath, '/var/lib/ghost/content');
        });

        it('should write subscriber record to database', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(subscribersInsertStub);
            const record = subscribersInsertStub.firstCall.args[0];
            assert.equal(record.member_id, 'member_123');
            assert.equal(record.username, 'testuser');
            assert.equal(record.container_id, 'ghost-sub-testuser');
            assert.equal(record.status, 'running');
            assert.equal(record.port, 2368);
        });

        it('should log creation event', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(eventsInsertStub);
            const event = eventsInsertStub.firstCall.args[0];
            assert.equal(event.event_type, 'created');
        });

        it('should register file share as ACA environment storage', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(containerAppsClientStub.managedEnvironmentsStorages.createOrUpdate);
            const callArgs = containerAppsClientStub.managedEnvironmentsStorages.createOrUpdate.firstCall.args;
            assert.equal(callArgs[0], 'ghost-platform-rg');
            assert.equal(callArgs[1], 'privatestack-env');
            assert.equal(callArgs[2], 'ghost-testuser');
            assert.equal(callArgs[3].properties.azureFile.shareName, 'ghost-testuser');
            assert.equal(callArgs[3].properties.azureFile.accessMode, 'ReadWrite');
        });

        it('should not include custom domains on initial creation', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            const envelope = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args[2];
            assert.equal(envelope.configuration.ingress.customDomains, undefined);
        });

        it('should reject invalid usernames', async function () {
            const manager = createManager();

            await assert.rejects(
                () => manager.createSubscriberContainer({
                    id: 'member_123',
                    email: 'test@example.com',
                    username: 'UPPER_CASE',
                    custom_domain: null
                }),
                {message: /Invalid username/}
            );

            await assert.rejects(
                () => manager.createSubscriberContainer({
                    id: 'member_123',
                    email: 'test@example.com',
                    username: 'has spaces',
                    custom_domain: null
                }),
                {message: /Invalid username/}
            );

            await assert.rejects(
                () => manager.createSubscriberContainer({
                    id: 'member_123',
                    email: 'test@example.com',
                    username: '1startswithnumber',
                    custom_domain: null
                }),
                {message: /Invalid username/}
            );
        });

        it('should clean up file share if container app creation fails', async function () {
            containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait
                .rejects(new Error('ACA provisioning failed'));

            const manager = createManager();

            await assert.rejects(
                () => manager.createSubscriberContainer({
                    id: 'member_123',
                    email: 'test@example.com',
                    username: 'testuser',
                    custom_domain: null
                }),
                {message: /ACA provisioning failed/}
            );

            const shareClient = shareServiceClientStub.getShareClient.returnValues[0];
            sinon.assert.calledOnce(shareClient.delete);
        });

        it('should return container app name and URL', async function () {
            const manager = createManager();
            const result = await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            assert.equal(result.containerAppName, 'ghost-sub-testuser');
            assert.equal(result.url, 'https://testuser.private-stack.dev');
            assert.ok(result.subscriberId);
            assert.ok(result.fqdn);
        });
    });

    describe('deleteSubscriberContainer', function () {
        it('should delete the container app', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.beginDeleteAndWait);
            sinon.assert.calledWith(
                containerAppsClientStub.containerApps.beginDeleteAndWait,
                'ghost-platform-rg',
                'ghost-sub-testuser'
            );
        });

        it('should delete the Azure File Share', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            const shareClient = shareServiceClientStub.getShareClient.returnValues[0];
            sinon.assert.calledOnce(shareClient.delete);
        });

        it('should log deletion event and remove database record', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(eventsInsertStub);
            const event = eventsInsertStub.firstCall.args[0];
            assert.equal(event.event_type, 'deleted');
        });

        it('should still remove database record if container app delete fails', async function () {
            containerAppsClientStub.containerApps.beginDeleteAndWait
                .rejects(new Error('ACA delete failed'));

            const subscribersDeleteStub = sinon.stub().resolves();
            const knexForDelete = function (tableName) {
                if (tableName === 'subscribers') {
                    return {
                        where: sinon.stub().callsFake(() => ({
                            first: sinon.stub().resolves({
                                id: 'sub_123',
                                username: 'testuser',
                                container_id: 'ghost-sub-testuser'
                            }),
                            delete: subscribersDeleteStub
                        }))
                    };
                }
                if (tableName === 'subscriber_container_events') {
                    return {insert: eventsInsertStub};
                }
                return {insert: sinon.stub().resolves()};
            };

            const manager = createManager();
            manager.getKnex = () => knexForDelete;
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(subscribersDeleteStub);
            sinon.assert.calledOnce(eventsInsertStub);
        });

        it('should throw if subscriber not found', async function () {
            const manager = createManager();

            const emptyKnex = function (tableName) {
                if (tableName === 'subscribers') {
                    return {
                        where: sinon.stub().returnsThis(),
                        first: sinon.stub().resolves(null),
                        delete: sinon.stub().resolves()
                    };
                }
                return {insert: sinon.stub().resolves()};
            };
            manager.getKnex = () => emptyKnex;

            await assert.rejects(
                () => manager.deleteSubscriberContainer('nonexistent'),
                {message: /Subscriber not found/}
            );
        });
    });

    describe('addCustomDomain', function () {
        it('should add a custom domain to an existing container app', async function () {
            containerAppsClientStub.containerApps.get.resolves({
                location: 'francecentral',
                configuration: {
                    ingress: {
                        external: true,
                        targetPort: 2368,
                        customDomains: []
                    }
                },
                template: {containers: [{name: 'ghost'}]}
            });

            const manager = createManager();
            await manager.addCustomDomain('testuser', 'testuser.private-stack.dev');

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait);
            const envelope = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args[2];
            const domains = envelope.configuration.ingress.customDomains;
            assert.equal(domains.length, 1);
            assert.equal(domains[0].name, 'testuser.private-stack.dev');
            assert.equal(domains[0].bindingType, 'Disabled');
        });

        it('should use SniEnabled when certificateId is provided', async function () {
            containerAppsClientStub.containerApps.get.resolves({
                location: 'francecentral',
                configuration: {
                    ingress: {
                        external: true,
                        targetPort: 2368,
                        customDomains: []
                    }
                },
                template: {containers: [{name: 'ghost'}]}
            });

            const manager = createManager();
            await manager.addCustomDomain('testuser', 'testuser.private-stack.dev', 'cert-123');

            const envelope = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args[2];
            const domains = envelope.configuration.ingress.customDomains;
            assert.equal(domains[0].bindingType, 'SniEnabled');
            assert.equal(domains[0].certificateId, 'cert-123');
        });
    });

    describe('getSubscriberStatus', function () {
        it('should query ACA API for container app status', async function () {
            const manager = createManager();
            const status = await manager.getSubscriberStatus('testuser');

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.get);
            sinon.assert.calledWith(
                containerAppsClientStub.containerApps.get,
                'ghost-platform-rg',
                'ghost-sub-testuser'
            );
            assert.equal(status.provisioningState, 'Succeeded');
        });
    });
});
