const should = require('should');
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

        should(next.called).be.false();
        res.cookie.calledOnce.should.be.true();
        res.cookie.firstCall.args[0].should.equal('ghost-members-ssr');

        // Verify cookie contains member ID
        const cookieValue = res.cookie.firstCall.args[1];
        cookieValue.should.be.type('string');
        const parsedCookie = JSON.parse(cookieValue);
        parsedCookie.should.have.property('memberId', 'mem_123');
        parsedCookie.should.have.property('accessType', 'bearer-token');

        res.redirect.calledWith('/').should.be.true();
    });

    it('should reject invalid token (wrong length)', async function () {
        req.params.token = 'tooshort';

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.instanceOf(errors.UnauthorizedError);
    });

    it('should reject token not found in database', async function () {
        MemberCryptoSubscription.findOne.resolves(null);

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.instanceOf(errors.UnauthorizedError);
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

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.instanceOf(errors.UnauthorizedError);
    });

    it('should handle missing token parameter', async function () {
        req.params.token = undefined;

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.instanceOf(errors.UnauthorizedError);
    });

    it('should handle database errors gracefully', async function () {
        const dbError = new Error('Database connection failed');
        MemberCryptoSubscription.findOne.callsFake(async function () {
            throw dbError;
        });

        await accessTokenAuth.authenticate(req, res, next, MemberCryptoSubscription);

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.equal(dbError);
    });
});
