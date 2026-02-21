const assert = require('node:assert/strict');
const sinon = require('sinon');
const errors = require('@tryghost/errors');

describe('Access Token Authentication', function () {
    let req, res, next;
    let MemberCryptoSubscription;
    let accessTokenAuth;

    beforeEach(function () {
        req = {
            params: {token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
            session: {}
        };
        res = {
            cookie: sinon.stub().returnsThis(),
            redirect: sinon.stub()
        };
        next = sinon.stub();

        // Mock the model
        MemberCryptoSubscription = {
            findOne: sinon.stub()
        };

        // Clear require cache to get fresh module
        delete require.cache[require.resolve('../../../../../core/server/web/members/access-token-auth')];
        accessTokenAuth = require('../../../../../core/server/web/members/access-token-auth');
    });

    afterEach(function () {
        sinon.restore();
    });

    it('should authenticate valid token and set cookie', async function () {
        const memberData = {
            id: 'mem_123',
            get: sinon.stub().returns('mem_123')
        };

        const subscriptionData = {
            id: 'sub_123',
            get: sinon.stub(),
            related: sinon.stub()
        };
        subscriptionData.get.withArgs('status').returns('active');
        subscriptionData.get.withArgs('member_id').returns('mem_123');
        subscriptionData.related.withArgs('member').returns(memberData);

        MemberCryptoSubscription.findOne.resolves(subscriptionData);

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        assert.equal(next.called, false);
        assert.equal(res.cookie.calledOnce, true);
        assert.equal(res.cookie.firstCall.args[0], 'ghost-members-ssr');

        // Verify cookie contains member ID
        const cookieValue = res.cookie.firstCall.args[1];
        assert.equal(typeof cookieValue, 'string');
        const parsedCookie = JSON.parse(cookieValue);
        assert.equal(parsedCookie.memberId, 'mem_123');
        assert.equal(parsedCookie.accessType, 'bearer-token');

        assert.equal(res.redirect.calledWith('/'), true);
    });

    it('should reject invalid token (wrong length)', async function () {
        req.params.token = 'tooshort';

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        assert.equal(res.cookie.called, false);
        assert.equal(next.calledOnce, true);
        assert.ok(next.firstCall.args[0] instanceof errors.UnauthorizedError);
    });

    it('should reject token not found in database', async function () {
        MemberCryptoSubscription.findOne.resolves(null);

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        assert.equal(res.cookie.called, false);
        assert.equal(next.calledOnce, true);
        assert.ok(next.firstCall.args[0] instanceof errors.UnauthorizedError);
    });

    it('should reject expired subscription', async function () {
        MemberCryptoSubscription.findOne.resolves({
            id: 'sub_123',
            get: function (key) {
                const data = {
                    member_id: 'mem_123',
                    status: 'canceled',
                    access_token: 'abc123def456789012345678901234567890123456789012345678901234'
                };
                return data[key];
            },
            related: function () {
                return {id: 'mem_123', get: () => 'mem_123'};
            }
        });

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        assert.equal(res.cookie.called, false);
        assert.equal(next.calledOnce, true);
        assert.ok(next.firstCall.args[0] instanceof errors.UnauthorizedError);
    });

    it('should handle missing token parameter', async function () {
        req.params.token = undefined;

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        assert.equal(res.cookie.called, false);
        assert.equal(next.calledOnce, true);
        assert.ok(next.firstCall.args[0] instanceof errors.UnauthorizedError);
    });

    it('should handle database errors gracefully', async function () {
        const dbError = new Error('Database connection failed');
        MemberCryptoSubscription.findOne.callsFake(async function () {
            throw dbError;
        });

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        assert.equal(res.cookie.called, false);
        assert.equal(next.calledOnce, true);
        assert.equal(next.firstCall.args[0], dbError);
    });
});
