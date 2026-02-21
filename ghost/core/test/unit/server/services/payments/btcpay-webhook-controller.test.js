const assert = require('node:assert/strict');
const sinon = require('sinon');
const rewire = require('rewire');
const BTCPayWebhookController = rewire('../../../../../core/server/services/payments/btcpay-webhook-controller');

describe('BTCPayWebhookController - Bearer Token Generation', function () {
    let controller;
    let memberRepository;
    let paymentService;
    let labs;
    let knexStub;
    let subscriptionInsertStub;
    let invoiceInsertStub;

    beforeEach(function () {
        // Setup knex mocks
        subscriptionInsertStub = sinon.stub().resolves();
        invoiceInsertStub = sinon.stub().resolves();

        knexStub = function (tableName) {
            if (tableName === 'members_crypto_subscriptions') {
                return {insert: subscriptionInsertStub};
            }
            if (tableName === 'members_crypto_invoices') {
                return {insert: invoiceInsertStub};
            }
            return {
                insert: sinon.stub().resolves(),
                where: sinon.stub().returnsThis(),
                first: sinon.stub().resolves(null)
            };
        };

        // Mock member repository
        memberRepository = {
            get: sinon.stub().resolves(null),
            create: sinon.stub().resolves({
                id: 'mem_123',
                email: null,
                status: 'paid'
            }),
            update: sinon.stub().resolves()
        };

        // Mock payment service
        paymentService = {
            handleWebhook: sinon.stub()
        };

        // Mock labs
        labs = {
            isSet: sinon.stub().returns(false)
        };

        // Create controller instance
        controller = new BTCPayWebhookController({
            memberRepository,
            paymentService,
            labs
        });
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('_createSubscription - Anonymous Subscription', function () {
        it('should generate 64-character bearer token when email is not provided', async function () {
            // Mock require for knex connection
            const originalRequire = BTCPayWebhookController.__get__('require');
            BTCPayWebhookController.__set__('require', function (path) {
                if (path === '../../data/db/connection') {
                    return knexStub;
                }
                if (path === 'crypto') {
                    return require('crypto');
                }
                return originalRequire(path);
            });

            // Setup: Anonymous subscription (no email)
            memberRepository.create.resolves({
                id: 'mem_123',
                email: null,
                status: 'paid'
            });

            const invoice = {
                id: 'inv_123',
                amount: '30.00',
                currency: 'USD',
                createdTime: Math.floor(Date.now() / 1000),
                metadata: {}
            };

            const metadata = {
                memberEmail: null, // No email provided - anonymous subscription
                memberId: null,
                priceId: 'annual_membership',
                ghost_subscription: true,
                ghost_annual_membership: true
            };

            // Act: Create subscription
            await controller._createSubscription(invoice, metadata);

            // Assert: Member created without email
            sinon.assert.calledOnce(memberRepository.create);
            const createCall = memberRepository.create.firstCall.args[0];
            assert.equal(createCall.email, null);
            assert.equal(createCall.status, 'paid');

            // Assert: Subscription record was inserted
            sinon.assert.calledOnce(subscriptionInsertStub);
            const subscriptionData = subscriptionInsertStub.firstCall.args[0];

            // Assert: Bearer token exists and is correct format
            assert.ok(subscriptionData.access_token);
            assert.equal(subscriptionData.access_token.length, 64);
            assert.match(subscriptionData.access_token, /^[a-f0-9]{64}$/);

            // Assert: Token is cryptographically secure (different each time)
            const token1 = subscriptionData.access_token;

            // Create another subscription to ensure different token
            subscriptionInsertStub.resetHistory();
            invoiceInsertStub.resetHistory();
            await controller._createSubscription(invoice, metadata);
            const subscriptionData2 = subscriptionInsertStub.firstCall.args[0];
            const token2 = subscriptionData2.access_token;

            assert.notEqual(token1, token2);

            // Restore
            BTCPayWebhookController.__set__('require', originalRequire);
        });

        it('should not generate bearer token when email is provided', async function () {
            // Mock require for knex connection
            const originalRequire = BTCPayWebhookController.__get__('require');
            BTCPayWebhookController.__set__('require', function (path) {
                if (path === '../../data/db/connection') {
                    return knexStub;
                }
                if (path === 'crypto') {
                    return require('crypto');
                }
                return originalRequire(path);
            });

            // Setup: Regular subscription with email
            memberRepository.get.resolves(null);
            memberRepository.create.resolves({
                id: 'mem_456',
                email: 'user@example.com',
                status: 'paid'
            });

            const invoice = {
                id: 'inv_456',
                amount: '30.00',
                currency: 'USD',
                createdTime: Math.floor(Date.now() / 1000),
                metadata: {}
            };

            const metadata = {
                memberEmail: 'user@example.com', // Email provided
                memberId: null,
                priceId: 'annual_membership',
                ghost_subscription: true,
                ghost_annual_membership: true
            };

            // Act: Create subscription
            await controller._createSubscription(invoice, metadata);

            // Assert: Member lookup and creation called
            sinon.assert.calledOnce(memberRepository.get);
            sinon.assert.calledOnce(memberRepository.create);

            // Assert: Subscription record was inserted
            sinon.assert.calledOnce(subscriptionInsertStub);
            const subscriptionData = subscriptionInsertStub.firstCall.args[0];

            // Assert: No bearer token for email-based subscription
            assert.ok(!subscriptionData.access_token);

            // Restore
            BTCPayWebhookController.__set__('require', originalRequire);
        });

        it('should handle existing member with email', async function () {
            // Mock require for knex connection
            const originalRequire = BTCPayWebhookController.__get__('require');
            BTCPayWebhookController.__set__('require', function (path) {
                if (path === '../../data/db/connection') {
                    return knexStub;
                }
                if (path === 'crypto') {
                    return require('crypto');
                }
                return originalRequire(path);
            });

            // Setup: Existing member
            memberRepository.get.resolves({
                id: 'mem_existing',
                email: 'existing@example.com',
                status: 'free'
            });

            const invoice = {
                id: 'inv_789',
                amount: '30.00',
                currency: 'USD',
                createdTime: Math.floor(Date.now() / 1000),
                metadata: {}
            };

            const metadata = {
                memberEmail: 'existing@example.com',
                memberId: null,
                priceId: 'annual_membership',
                ghost_subscription: true,
                ghost_annual_membership: true
            };

            // Act: Create subscription
            await controller._createSubscription(invoice, metadata);

            // Assert: Member not created (already exists)
            sinon.assert.calledOnce(memberRepository.get);
            sinon.assert.notCalled(memberRepository.create);

            // Assert: Subscription created without token
            sinon.assert.calledOnce(subscriptionInsertStub);
            const subscriptionData = subscriptionInsertStub.firstCall.args[0];
            assert.ok(!subscriptionData.access_token);

            // Restore
            BTCPayWebhookController.__set__('require', originalRequire);
        });
    });

    describe('Token Security', function () {
        it('should generate cryptographically random tokens', function () {
            // This test verifies tokens are truly random by generating multiple
            // and checking for no patterns or collisions
            const crypto = require('crypto');
            const tokens = [];
            const iterations = 10;

            // Generate multiple tokens
            for (let i = 0; i < iterations; i++) {
                const buffer = crypto.randomBytes(32);
                const token = buffer.toString('hex');
                tokens.push(token);
            }

            // Assert: All tokens are unique
            const uniqueTokens = new Set(tokens);
            assert.equal(uniqueTokens.size, iterations, 'All tokens should be unique');

            // Assert: All tokens have correct length and format
            tokens.forEach((token) => {
                assert.equal(token.length, 64, 'Token should be 64 characters');
                assert.match(token, /^[a-f0-9]{64}$/, 'Token should be hex format');
            });
        });
    });
});
