const assert = require('node:assert/strict');
const {assertExists} = require('../../../../../utils/assertions');
const _ = require('lodash');
const sinon = require('sinon');
const ghostLocals = require('../../../../../../core/server/web/parent/middleware/ghost-locals');

describe('Theme Handler', function () {
    let req;
    let res;
    let next;

    beforeEach(function () {
        req = sinon.spy();
        res = sinon.spy();
        next = sinon.spy();
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('ghostLocals', function () {
        it('sets all locals', function () {
            req.path = '/awesome-post';

            ghostLocals(req, res, next);

            assert(_.isPlainObject(res.locals));
            assertExists(res.locals.version);
            assertExists(res.locals.safeVersion);
            assert.equal(res.locals.relativeUrl, req.path);
            assert.equal(next.called, true);
        });
    });

    describe('onion host detection', function () {
        it('should set isOnionRequest to true for .onion hostnames', function () {
            req.path = '/test';
            req.hostname = 'abcdef1234567890.onion';

            ghostLocals(req, res, next);

            assert.equal(res.locals.isOnionRequest, true);
        });

        it('should set isOnionRequest to false for clearnet hostnames', function () {
            req.path = '/test';
            req.hostname = 'alice.private-stack.dev';

            ghostLocals(req, res, next);

            assert.equal(res.locals.isOnionRequest, false);
        });

        it('should set isOnionRequest to false when hostname is undefined', function () {
            req.path = '/test';
            req.hostname = undefined;

            ghostLocals(req, res, next);

            assert.equal(res.locals.isOnionRequest, false);
        });

        it('should still set version and relativeUrl alongside isOnionRequest', function () {
            req.path = '/test';
            req.hostname = 'example.com';

            ghostLocals(req, res, next);

            assertExists(res.locals.version);
            assert.equal(res.locals.relativeUrl, '/test');
            assert.equal(res.locals.isOnionRequest, false);
        });
    });
});
