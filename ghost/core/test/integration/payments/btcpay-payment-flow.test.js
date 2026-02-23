const assert = require('node:assert/strict');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

/**
 * Payment Flow Integration Tests
 *
 * Tests the complete BTCPay payment pipeline:
 *   webhook → controller → database writes → token generation → access route
 *
 * Uses a real Express app with actual controllers wired together,
 * but stubs the database layer and external services.
 */
describe('BTCPay Payment Flow - End to End', function () {
    let app;
    let subscriptions;
    let invoices;
    let members;
    let knexStub;

    beforeEach(function () {
        // In-memory database stores
        subscriptions = new Map();
        invoices = new Map();
        members = new Map();

        // Chainable knex stub backed by in-memory stores
        knexStub = function (tableName) {
            if (tableName === 'members_crypto_subscriptions') {
                return {
                    insert: sinon.stub().callsFake(async (data) => {
                        subscriptions.set(data.id, data);
                    }),
                    where: sinon.stub().callsFake((key, value) => {
                        return {
                            first: sinon.stub().callsFake(async () => {
                                for (const sub of subscriptions.values()) {
                                    if (sub[key] === value) {
                                        return sub;
                                    }
                                }
                                return null;
                            }),
                            update: sinon.stub().callsFake(async (data) => {
                                for (const [id, sub] of subscriptions.entries()) {
                                    if (sub[key] === value) {
                                        subscriptions.set(id, {...sub, ...data});
                                    }
                                }
                            })
                        };
                    })
                };
            }
            if (tableName === 'members_crypto_invoices') {
                return {
                    insert: sinon.stub().callsFake(async (data) => {
                        invoices.set(data.id, data);
                    })
                };
            }
            if (tableName === 'members') {
                return {
                    where: sinon.stub().callsFake((key, value) => {
                        return {
                            first: sinon.stub().callsFake(async () => {
                                for (const mem of members.values()) {
                                    if (mem[key] === value) {
                                        return mem;
                                    }
                                }
                                return null;
                            })
                        };
                    })
                };
            }
            return {
                insert: sinon.stub().resolves(),
                where: sinon.stub().returnsThis(),
                first: sinon.stub().resolves(null),
                update: sinon.stub().resolves()
            };
        };
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('Anonymous Bitcoin Payment → Bearer Token → Access', function () {
        it('full flow: webhook creates subscription with access token', async function () {
            // Arrange: Wire up real controller with stubbed deps
            const BTCPayWebhookController = require('../../../core/server/services/payments/btcpay-webhook-controller');

            const memberRepository = {
                get: sinon.stub().resolves(null),
                create: sinon.stub().callsFake(async (data) => {
                    const id = crypto.randomUUID();
                    const member = {id, ...data};
                    members.set(id, member);
                    return member;
                }),
                update: sinon.stub().resolves()
            };

            const paymentService = {
                handleWebhook: sinon.stub().callsFake(async (_provider, req) => {
                    return {
                        ...req.body,
                        type: req.body.type
                    };
                })
            };

            const controller = new BTCPayWebhookController({
                memberRepository,
                paymentService,
                labs: {isSet: () => false}
            });

            // Stub the knex require inside the controller
            const Module = require('module');
            const originalRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === '../../data/db/connection') {
                    return knexStub;
                }
                if (id === '../subscriber-provisioning') {
                    // Stub provisioner to avoid Docker/Azure calls
                    return function () {
                        return {
                            provisionSubscriber: sinon.stub().resolves({
                                container: 'test-container',
                                port: 2370,
                                url: 'https://anon-abc123.private-stack.dev'
                            })
                        };
                    };
                }
                return originalRequire.apply(this, arguments);
            };

            app = express();
            app.use(express.json());
            app.post('/webhooks/btcpay', (req, res) => controller.handle(req, res));

            // Act: Send anonymous Bitcoin payment settled webhook
            const webhookPayload = {
                type: 'InvoiceSettled',
                id: 'inv_anon_001',
                invoiceId: 'inv_anon_001',
                amount: '30.00',
                currency: 'USD',
                createdTime: Math.floor(Date.now() / 1000),
                metadata: {
                    ghost_subscription: true,
                    ghost_annual_membership: true,
                    memberEmail: null,
                    priceId: 'annual_btc'
                }
            };

            const response = await request(app)
                .post('/webhooks/btcpay')
                .send(webhookPayload)
                .expect(200);

            // Restore require
            Module.prototype.require = originalRequire;

            // Assert: Webhook acknowledged
            assert.equal(response.body.received, true);

            // Assert: Member created (anonymous)
            assert.equal(memberRepository.create.calledOnce, true);
            const createArgs = memberRepository.create.firstCall.args[0];
            assert.equal(createArgs.email, null);
            assert.equal(createArgs.status, 'paid');

            // Assert: Subscription created with access token
            assert.equal(subscriptions.size, 1);
            const sub = [...subscriptions.values()][0];
            assert.equal(sub.provider, 'btcpay');
            assert.equal(sub.subscription_id, 'inv_anon_001');
            assert.equal(sub.status, 'active');
            assert.equal(sub.interval, 'year');
            assert.equal(sub.amount, 3000);

            // Assert: Access token generated (64 hex chars)
            assert.ok(sub.access_token, 'Access token should be generated for anonymous subscription');
            assert.equal(sub.access_token.length, 64);
            assert.match(sub.access_token, /^[a-f0-9]{64}$/);

            // Assert: Invoice record created
            assert.equal(invoices.size, 1);
        });

        it('full flow: email-based payment does NOT generate access token', async function () {
            const BTCPayWebhookController = require('../../../core/server/services/payments/btcpay-webhook-controller');

            const memberRepository = {
                get: sinon.stub().resolves(null),
                create: sinon.stub().callsFake(async (data) => {
                    const id = crypto.randomUUID();
                    const member = {id, ...data};
                    members.set(id, member);
                    return member;
                }),
                update: sinon.stub().resolves()
            };

            const paymentService = {
                handleWebhook: sinon.stub().callsFake(async (_provider, req) => ({...req.body, type: req.body.type}))
            };

            const controller = new BTCPayWebhookController({
                memberRepository,
                paymentService,
                labs: {isSet: () => false}
            });

            const Module = require('module');
            const originalRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === '../../data/db/connection') {
                    return knexStub;
                }
                if (id === '../subscriber-provisioning') {
                    return function () {
                        return {provisionSubscriber: sinon.stub().resolves({url: 'https://alice-abc123.private-stack.dev'})};
                    };
                }
                return originalRequire.apply(this, arguments);
            };

            app = express();
            app.use(express.json());
            app.post('/webhooks/btcpay', (req, res) => controller.handle(req, res));

            const response = await request(app)
                .post('/webhooks/btcpay')
                .send({
                    type: 'InvoiceSettled',
                    id: 'inv_email_001',
                    invoiceId: 'inv_email_001',
                    amount: '30.00',
                    currency: 'USD',
                    createdTime: Math.floor(Date.now() / 1000),
                    metadata: {
                        ghost_subscription: true,
                        ghost_annual_membership: true,
                        memberEmail: 'alice@example.com',
                        priceId: 'annual_btc'
                    }
                })
                .expect(200);

            Module.prototype.require = originalRequire;

            assert.equal(response.body.received, true);

            // Assert: Member created with email
            const createArgs = memberRepository.create.firstCall.args[0];
            assert.equal(createArgs.email, 'alice@example.com');

            // Assert: NO access token for email-based subscription
            const sub = [...subscriptions.values()][0];
            assert.equal(sub.access_token, null, 'Email-based subscription should not have access token');
            assert.equal(sub.subscription_id, 'inv_email_001');
        });
    });

    describe('Payment Success Handler', function () {
        it('returns access URL for anonymous subscription', async function () {
            // Arrange: Pre-populate subscription + member
            const token = crypto.randomBytes(32).toString('hex');
            subscriptions.set('sub_1', {
                id: 'sub_1',
                subscription_id: 'inv_anon_002',
                member_id: 'mem_1',
                status: 'active',
                access_token: token
            });
            members.set('mem_1', {id: 'mem_1', email: null});

            // Stub knex require for the handler
            const Module = require('module');
            const originalRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === '../../data/db/connection') {
                    return knexStub;
                }
                return originalRequire.apply(this, arguments);
            };

            delete require.cache[require.resolve('../../../core/server/web/members/payment-success-handler')];
            const paymentSuccessHandler = require('../../../core/server/web/members/payment-success-handler');

            app = express();
            app.get('/members/payment-success', paymentSuccessHandler.handlePaymentSuccess);

            // Act
            const response = await request(app)
                .get('/members/payment-success?invoiceId=inv_anon_002')
                .expect(200);

            Module.prototype.require = originalRequire;

            // Assert
            assert.equal(response.body.success, true);
            assert.equal(response.body.anonymous, true);
            assert.equal(response.body.accessToken, token);
            assert.ok(response.body.accessUrl.includes(token));
            assert.ok(response.body.accessUrl.includes('/members/access/'));
        });

        it('returns email confirmation for email-based subscription', async function () {
            subscriptions.set('sub_2', {
                id: 'sub_2',
                subscription_id: 'inv_email_002',
                member_id: 'mem_2',
                status: 'active',
                access_token: null
            });
            members.set('mem_2', {id: 'mem_2', email: 'bob@example.com'});

            const Module = require('module');
            const originalRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === '../../data/db/connection') {
                    return knexStub;
                }
                return originalRequire.apply(this, arguments);
            };

            delete require.cache[require.resolve('../../../core/server/web/members/payment-success-handler')];
            const paymentSuccessHandler = require('../../../core/server/web/members/payment-success-handler');

            app = express();
            app.get('/members/payment-success', paymentSuccessHandler.handlePaymentSuccess);

            const response = await request(app)
                .get('/members/payment-success?invoiceId=inv_email_002')
                .expect(200);

            Module.prototype.require = originalRequire;

            assert.equal(response.body.success, true);
            assert.equal(response.body.anonymous, false);
            assert.equal(response.body.email, 'bob@example.com');
            assert.equal(response.body.accessToken, undefined);
        });
    });

    describe('Bearer Token Access Route', function () {
        it('sets authentication cookie for valid access token', async function () {
            const token = 'a'.repeat(64);

            // Mock the MemberCryptoSubscription model
            const MemberCryptoSubscription = {
                findOne: sinon.stub().resolves({
                    id: 'sub_1',
                    get: function (key) {
                        const data = {status: 'active', member_id: 'mem_1'};
                        return data[key];
                    },
                    related: function () {
                        return {id: 'mem_1', get: () => 'mem_1'};
                    }
                })
            };

            delete require.cache[require.resolve('../../../core/server/web/members/access-token-auth')];
            const accessTokenAuth = require('../../../core/server/web/members/access-token-auth');

            app = express();
            app.get('/members/access/:token', (req, res, next) => {
                accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);
            });

            const response = await request(app)
                .get(`/members/access/${token}`)
                .expect(302);

            // Assert: Cookie set
            const setCookie = response.headers['set-cookie'];
            assert.ok(setCookie, 'Response should set a cookie');
            assert.ok(setCookie[0].includes('ghost-members-ssr'), 'Cookie should be ghost-members-ssr');
            assert.ok(setCookie[0].includes('HttpOnly'), 'Cookie should be HttpOnly');

            // Assert: Redirects to home
            assert.equal(response.headers.location, '/');
        });

        it('rejects invalid token with 401', async function () {
            delete require.cache[require.resolve('../../../core/server/web/members/access-token-auth')];
            const accessTokenAuth = require('../../../core/server/web/members/access-token-auth');

            app = express();
            app.get('/members/access/:token', (req, res, next) => {
                accessTokenAuth.authenticate(req, res, next, {
                    findOne: sinon.stub().resolves(null)
                });
            });
            // Error handler
            app.use((err, _req, res, _next) => {
                res.status(err.statusCode || 500).json({error: err.message});
            });

            await request(app)
                .get('/members/access/tooshort')
                .expect(401);
        });
    });

    describe('Container Provisioning with Onion', function () {
        it('passes onion_enabled flag to provisioner', async function () {
            const BTCPayWebhookController = require('../../../core/server/services/payments/btcpay-webhook-controller');
            const provisionStub = sinon.stub().resolves({
                url: 'https://anon-def456.private-stack.dev',
                onionAddress: 'abc123xyz.onion'
            });

            const memberRepository = {
                get: sinon.stub().resolves(null),
                create: sinon.stub().callsFake(async (data) => {
                    const id = crypto.randomUUID();
                    return {id, ...data};
                }),
                update: sinon.stub().resolves()
            };

            const paymentService = {
                handleWebhook: sinon.stub().callsFake(async (_p, req) => ({...req.body, type: req.body.type}))
            };

            const controller = new BTCPayWebhookController({
                memberRepository,
                paymentService,
                labs: {isSet: () => false}
            });

            const Module = require('module');
            const originalRequire = Module.prototype.require;
            Module.prototype.require = function (id) {
                if (id === '../../data/db/connection') {
                    return knexStub;
                }
                if (id === '../subscriber-provisioning') {
                    return function () {
                        return {provisionSubscriber: provisionStub};
                    };
                }
                return originalRequire.apply(this, arguments);
            };

            app = express();
            app.use(express.json());
            app.post('/webhooks/btcpay', (req, res) => controller.handle(req, res));

            await request(app)
                .post('/webhooks/btcpay')
                .send({
                    type: 'InvoiceSettled',
                    id: 'inv_onion_001',
                    invoiceId: 'inv_onion_001',
                    amount: '30.00',
                    currency: 'USD',
                    createdTime: Math.floor(Date.now() / 1000),
                    metadata: {
                        ghost_subscription: true,
                        ghost_annual_membership: true,
                        memberEmail: null,
                        onion_enabled: true
                    }
                })
                .expect(200);

            Module.prototype.require = originalRequire;

            // Assert: Provisioner was called with onion_enabled: true
            assert.equal(provisionStub.calledOnce, true);
            const provisionArgs = provisionStub.firstCall.args[0];
            assert.equal(provisionArgs.onion_enabled, true);
        });
    });
});
