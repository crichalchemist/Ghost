const assert = require('node:assert/strict');
const sinon = require('sinon');

describe('SubscriberProvisioningService', function () {
    let SubscriberProvisioningService;
    let dockerManagerStub;
    let knexStub;
    let fsStub;
    let execAsyncStub;

    beforeEach(function () {
        SubscriberProvisioningService = require('../../../../../core/server/services/subscriber-provisioning');

        dockerManagerStub = {
            createSubscriberContainer: sinon.stub().resolves({
                container: 'ctn_abc',
                port: 2370,
                url: 'https://testuser.private-stack.dev',
                customDomain: null,
                subscriberId: 'sub_123'
            }),
            deleteSubscriberContainer: sinon.stub().resolves()
        };

        fsStub = {
            writeFile: sinon.stub().resolves()
        };

        execAsyncStub = sinon.stub().resolves({stdout: '', stderr: ''});

        knexStub = sinon.stub().callsFake(function (tableName) {
            if (tableName === 'subscribers') {
                return {
                    where: sinon.stub().returnsThis(),
                    select: sinon.stub().resolves([
                        {username: 'alice', port: 2370, custom_domain: null},
                        {username: 'bob', port: 2371, custom_domain: 'bob-blog.com'}
                    ])
                };
            }
            return {};
        });
    });

    afterEach(function () {
        sinon.restore();
        // Clear require cache so next test gets fresh module
        delete require.cache[require.resolve('../../../../../core/server/services/subscriber-provisioning')];
    });

    function createService(overrides = {}) {
        return new SubscriberProvisioningService({
            dockerManager: dockerManagerStub,
            getKnex: () => knexStub,
            fs: fsStub,
            execAsync: execAsyncStub,
            ...overrides
        });
    }

    describe('provisionSubscriber', function () {
        it('should delegate to dockerManager.createSubscriberContainer', async function () {
            const service = createService();
            const subscriber = {
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            };

            await service.provisionSubscriber(subscriber);

            sinon.assert.calledOnceWithExactly(
                dockerManagerStub.createSubscriberContainer,
                subscriber
            );
        });

        it('should update Caddy config after provisioning', async function () {
            const service = createService();
            await service.provisionSubscriber({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            // Should have written Caddyfile and reloaded
            sinon.assert.calledOnce(fsStub.writeFile);
            sinon.assert.calledOnce(execAsyncStub);
        });

        it('should return container result from dockerManager', async function () {
            const service = createService();
            const result = await service.provisionSubscriber({
                id: 'sub_1', email: 'test@example.com', username: 'testuser', custom_domain: null
            });

            assert.equal(result.container, 'ctn_abc');
            assert.equal(result.url, 'https://testuser.private-stack.dev');
        });

        it('should propagate errors from dockerManager', async function () {
            dockerManagerStub.createSubscriberContainer.rejects(new Error('Docker failed'));

            const service = createService();
            await assert.rejects(
                () => service.provisionSubscriber({id: 'sub_1', username: 'testuser'}),
                {message: /Docker failed/}
            );
        });
    });

    describe('deprovisionSubscriber', function () {
        it('should delegate to dockerManager.deleteSubscriberContainer', async function () {
            const service = createService();
            await service.deprovisionSubscriber('testuser');

            sinon.assert.calledOnceWithExactly(
                dockerManagerStub.deleteSubscriberContainer,
                'testuser'
            );
        });

        it('should update Caddy config after deprovisioning', async function () {
            const service = createService();
            await service.deprovisionSubscriber('testuser');

            sinon.assert.calledOnce(fsStub.writeFile);
        });
    });

    describe('updateCaddyConfig', function () {
        it('should fetch running subscribers from database', async function () {
            const service = createService();
            await service.updateCaddyConfig();

            sinon.assert.calledWith(knexStub, 'subscribers');
        });

        it('should write generated Caddy config to Caddyfile', async function () {
            const service = createService();
            await service.updateCaddyConfig();

            sinon.assert.calledOnce(fsStub.writeFile);
            const [filePath, content] = fsStub.writeFile.firstCall.args;
            assert.equal(filePath, 'Caddyfile');
            assert.ok(content.includes('private-stack.dev'), 'Should contain main domain');
            assert.ok(content.includes('alice.private-stack.dev'), 'Should contain alice');
            assert.ok(content.includes('bob-blog.com'), 'Should contain bob custom domain');
        });

        it('should reload Caddy via admin API', async function () {
            const service = createService();
            await service.updateCaddyConfig();

            sinon.assert.calledOnce(execAsyncStub);
            const cmd = execAsyncStub.firstCall.args[0];
            assert.ok(cmd.includes('localhost:2019'), 'Should hit Caddy admin API');
        });

        it('should not throw if Caddy reload fails', async function () {
            execAsyncStub.rejects(new Error('Caddy not running'));

            const service = createService();
            // Should not throw — Caddy reload failure is non-blocking
            await service.updateCaddyConfig();
        });
    });
});
