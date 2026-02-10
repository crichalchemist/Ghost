const should = require('should');
const sinon = require('sinon');
const errors = require('@tryghost/errors');

describe('Payment Success Handler', function () {
    let req, res, next;
    let knexStub;
    let paymentSuccessHandler;

    beforeEach(function () {
        req = {
            query: {invoiceId: 'inv_123'},
            protocol: 'https',
            get: sinon.stub().returns('example.com')
        };
        res = {
            json: sinon.stub(),
            status: sinon.stub().returnsThis()
        };
        next = sinon.stub();

        // Create a chainable query builder mock
        const queryBuilder = {
            where: sinon.stub(),
            first: sinon.stub()
        };
        queryBuilder.where.returns(queryBuilder);

        // Mock knex to return query builder
        knexStub = sinon.stub().returns(queryBuilder);
        knexStub.queryBuilder = queryBuilder;

        // Mock require to return our knex stub
        const Module = require('module');
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function (id) {
            if (id === '../../data/db/connection') {
                return knexStub;
            }
            return originalRequire.apply(this, arguments);
        };

        // Clear require cache to get fresh module
        delete require.cache[require.resolve('../../../../../core/server/web/members/payment-success-handler')];
        paymentSuccessHandler = require('../../../../../core/server/web/members/payment-success-handler');
    });

    afterEach(function () {
        sinon.restore();
    });

    it('should return access token for anonymous subscription', async function () {
        const subscription = {
            subscription_id: 'inv_123',
            member_id: 'mem_123',
            status: 'active',
            current_period_end: new Date('2027-01-01'),
            access_token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        };

        const member = {
            id: 'mem_123',
            email: null
        };

        // First call for subscription
        knexStub.queryBuilder.first.onFirstCall().resolves(subscription);
        // Second call for member
        knexStub.queryBuilder.first.onSecondCall().resolves(member);

        await paymentSuccessHandler.handlePaymentSuccess(req, res, next);

        res.json.calledOnce.should.be.true();
        const response = res.json.firstCall.args[0];
        response.should.have.property('success', true);
        response.should.have.property('anonymous', true);
        response.should.have.property('accessToken', subscription.access_token);
        response.should.have.property('accessUrl');
        response.accessUrl.should.equal('https://example.com/members/access/' + subscription.access_token);
    });

    it('should return success with email for email-based subscription', async function () {
        const subscription = {
            subscription_id: 'inv_123',
            member_id: 'mem_123',
            status: 'active',
            current_period_end: new Date('2027-01-01'),
            access_token: null
        };

        const member = {
            id: 'mem_123',
            email: 'user@example.com'
        };

        knexStub.queryBuilder.first.onFirstCall().resolves(subscription);
        knexStub.queryBuilder.first.onSecondCall().resolves(member);

        await paymentSuccessHandler.handlePaymentSuccess(req, res, next);

        res.json.calledOnce.should.be.true();
        const response = res.json.firstCall.args[0];
        response.should.have.property('success', true);
        response.should.have.property('anonymous', false);
        response.should.have.property('email', 'user@example.com');
    });

    it('should return error when invoice ID is missing', async function () {
        req.query.invoiceId = undefined;

        await paymentSuccessHandler.handlePaymentSuccess(req, res, next);

        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.instanceOf(errors.BadRequestError);
    });

    it('should return error when subscription not found', async function () {
        knexStub.queryBuilder.first.resolves(null);

        await paymentSuccessHandler.handlePaymentSuccess(req, res, next);

        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.instanceOf(errors.NotFoundError);
    });

    it('should return pending status when payment not settled', async function () {
        const subscription = {
            subscription_id: 'inv_123',
            member_id: 'mem_123',
            status: 'pending',
            access_token: 'token123'
        };

        knexStub.queryBuilder.first.resolves(subscription);

        await paymentSuccessHandler.handlePaymentSuccess(req, res, next);

        res.status.calledWith(202).should.be.true();
        res.json.calledOnce.should.be.true();
        const response = res.json.firstCall.args[0];
        response.should.have.property('success', false);
        response.should.have.property('status', 'pending');
    });
});
