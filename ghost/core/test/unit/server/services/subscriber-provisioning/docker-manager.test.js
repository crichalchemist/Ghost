const assert = require('node:assert/strict');
const sinon = require('sinon');
const DockerManager = require('../../../../../core/server/services/subscriber-provisioning/docker-manager');

describe('DockerManager', function () {
    let dockerStub;
    let fsStub;
    let knexStub;
    let subscribersInsertStub;
    let eventsInsertStub;

    beforeEach(function () {
        // Stub dockerode instance
        dockerStub = {
            listContainers: sinon.stub().resolves([]),
            createContainer: sinon.stub(),
            getContainer: sinon.stub(),
            getNetwork: sinon.stub(),
            createNetwork: sinon.stub().resolves()
        };

        // Stub fs-extra
        fsStub = {
            ensureDir: sinon.stub().resolves(),
            writeFile: sinon.stub().resolves(),
            remove: sinon.stub().resolves()
        };

        // Stub knex
        subscribersInsertStub = sinon.stub().resolves();
        eventsInsertStub = sinon.stub().resolves();

        knexStub = function (tableName) {
            if (tableName === 'subscribers') {
                return {
                    insert: subscribersInsertStub,
                    where: sinon.stub().returnsThis(),
                    first: sinon.stub().resolves({id: 'sub_123', container_id: 'ctn_abc'}),
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
        return new DockerManager({
            docker: dockerStub,
            fs: fsStub,
            getKnex: () => knexStub,
            subscribersPath: '/data/subscribers',
            basePort: 2370,
            ...overrides
        });
    }

    describe('generateConfig', function () {
        it('should generate valid Ghost config for subscriber', function () {
            const manager = createManager();
            const config = manager.generateConfig(
                {username: 'testuser', email: 'test@example.com'},
                2370
            );

            assert.equal(config.url, 'https://testuser.private-stack.dev');
            assert.equal(config.database.client, 'sqlite3');
            assert.ok(config.database.connection.filename.includes('testuser'));
        });

        it('should use internal Ghost port 2368 in config, not the host port', function () {
            const manager = createManager();
            const config = manager.generateConfig({username: 'testuser'}, 2370);

            // Ghost inside the container always listens on 2368
            assert.equal(config.port, 2368);
        });
    });

    describe('ensureNetwork', function () {
        it('should not create network if it already exists', async function () {
            dockerStub.getNetwork.returns({
                inspect: sinon.stub().resolves({Name: 'privatestack-subscribers'})
            });

            const manager = createManager();
            await manager.ensureNetwork();

            sinon.assert.notCalled(dockerStub.createNetwork);
        });

        it('should create network if it does not exist', async function () {
            dockerStub.getNetwork.returns({
                inspect: sinon.stub().rejects(new Error('network not found'))
            });

            const manager = createManager();
            await manager.ensureNetwork();

            sinon.assert.calledOnceWithExactly(dockerStub.createNetwork, {
                Name: 'privatestack-subscribers',
                Driver: 'bridge'
            });
        });
    });

    describe('getNextAvailablePort', function () {
        it('should return base port when no containers exist', async function () {
            dockerStub.listContainers.resolves([]);

            const manager = createManager({basePort: 2370});
            const port = await manager.getNextAvailablePort();

            assert.equal(port, 2370);
        });

        it('should skip used ports', async function () {
            dockerStub.listContainers.resolves([
                {Labels: {'subscriber.port': '2370'}},
                {Labels: {'subscriber.port': '2371'}}
            ]);

            const manager = createManager({basePort: 2370});
            const port = await manager.getNextAvailablePort();

            assert.equal(port, 2372);
        });

        it('should ignore containers without subscriber.port label', async function () {
            dockerStub.listContainers.resolves([
                {Labels: {'other.label': 'value'}},
                {Labels: {'subscriber.port': '2370'}}
            ]);

            const manager = createManager({basePort: 2370});
            const port = await manager.getNextAvailablePort();

            assert.equal(port, 2371);
        });
    });

    describe('createSubscriberContainer', function () {
        let containerStub;

        beforeEach(function () {
            containerStub = {
                id: 'container_abc123',
                start: sinon.stub().resolves()
            };
            dockerStub.createContainer.resolves(containerStub);
            dockerStub.getNetwork.returns({
                inspect: sinon.stub().resolves({Name: 'privatestack-subscribers'})
            });
        });

        it('should ensure network exists before creating container', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            sinon.assert.called(dockerStub.getNetwork);
        });

        it('should create subscriber directory and content subdirectory', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            sinon.assert.calledWith(fsStub.ensureDir, '/data/subscribers/testuser');
            sinon.assert.calledWith(fsStub.ensureDir, '/data/subscribers/testuser/content');
        });

        it('should write config.production.json (not config.development.json)', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            const writeCall = fsStub.writeFile.firstCall;
            assert.ok(writeCall.args[0].endsWith('config.production.json'),
                `Expected config.production.json but got: ${writeCall.args[0]}`);
        });

        it('should expose internal port 2368 and map to dynamic host port', async function () {
            dockerStub.listContainers.resolves([]); // port 2370 available

            const manager = createManager({basePort: 2370});
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            const containerConfig = dockerStub.createContainer.firstCall.args[0];

            // Ghost always listens on 2368 INSIDE the container
            assert.deepEqual(containerConfig.ExposedPorts, {'2368/tcp': {}});
            assert.deepEqual(containerConfig.HostConfig.PortBindings, {
                '2368/tcp': [{HostPort: '2370'}]
            });
        });

        it('should not set GHOST_PORT env var (Ghost uses 2368 internally)', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            const containerConfig = dockerStub.createContainer.firstCall.args[0];
            const hasGhostPort = containerConfig.Env.some(e => e.startsWith('GHOST_PORT='));
            assert.equal(hasGhostPort, false, 'Should not set GHOST_PORT');
        });

        it('should set correct labels on container', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            const labels = dockerStub.createContainer.firstCall.args[0].Labels;
            assert.equal(labels['subscriber.id'], 'sub_1');
            assert.equal(labels['subscriber.username'], 'testuser');
            assert.equal(labels['managed'], 'true');
        });

        it('should start the container after creating it', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            sinon.assert.calledOnce(containerStub.start);
        });

        it('should insert subscriber record into database', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            sinon.assert.calledOnce(subscribersInsertStub);
            const record = subscribersInsertStub.firstCall.args[0];
            assert.equal(record.member_id, 'sub_1');
            assert.equal(record.username, 'testuser');
            assert.equal(record.status, 'running');
            assert.equal(record.container_id, 'container_abc123');
        });

        it('should log container creation event', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            sinon.assert.calledOnce(eventsInsertStub);
            const event = eventsInsertStub.firstCall.args[0];
            assert.equal(event.event_type, 'created');
        });

        it('should return container info with correct URL', async function () {
            const manager = createManager();
            const result = await manager.createSubscriberContainer({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: 'myblog.com'
            });

            assert.equal(result.container, 'container_abc123');
            assert.equal(result.url, 'https://testuser.private-stack.dev');
            assert.equal(result.customDomain, 'myblog.com');
            assert.ok(result.subscriberId, 'Should return subscriberId');
        });
    });

    describe('deleteSubscriberContainer', function () {
        let containerStub;
        let subscribersDeleteStub;

        beforeEach(function () {
            containerStub = {
                stop: sinon.stub().resolves(),
                remove: sinon.stub().resolves()
            };
            dockerStub.getContainer.returns(containerStub);

            subscribersDeleteStub = sinon.stub().resolves();

            // Override knexStub for delete-specific chaining
            knexStub = function (tableName) {
                if (tableName === 'subscribers') {
                    return {
                        where: sinon.stub().callsFake(() => ({
                            first: sinon.stub().resolves({
                                id: 'sub_123',
                                username: 'testuser',
                                container_id: 'ctn_abc'
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
        });

        it('should throw if subscriber not found in database', async function () {
            knexStub = function (tableName) {
                if (tableName === 'subscribers') {
                    return {
                        where: sinon.stub().returns({
                            first: sinon.stub().resolves(null),
                            delete: sinon.stub().resolves()
                        })
                    };
                }
                return {insert: sinon.stub().resolves()};
            };

            const manager = createManager();
            await assert.rejects(
                () => manager.deleteSubscriberContainer('nonexistent'),
                {message: /Subscriber not found: nonexistent/}
            );
        });

        it('should stop and remove the Docker container', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(containerStub.stop);
            sinon.assert.calledOnce(containerStub.remove);
        });

        it('should log deletion event', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(eventsInsertStub);
            const event = eventsInsertStub.firstCall.args[0];
            assert.equal(event.event_type, 'deleted');
            assert.equal(event.subscriber_id, 'sub_123');
        });

        it('should delete subscriber from database', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(subscribersDeleteStub);
        });

        it('should remove subscriber directory from filesystem', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledWith(fsStub.remove, '/data/subscribers/testuser');
        });
    });
});
