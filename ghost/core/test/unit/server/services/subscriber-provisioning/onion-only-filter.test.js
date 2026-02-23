const assert = require('node:assert/strict');

describe('Onion-Only Post Filtering', function () {
    it('enforcedFilters adds onion_only:false for clearnet requests', function () {
        const {Post} = require('../../../../../core/server/models/post');
        const filter = Post.prototype.enforcedFilters.call({}, {
            context: {public: true, isOnionRequest: false}
        });
        assert.ok(filter.includes('onion_only:false'));
    });

    it('enforcedFilters does NOT add onion_only filter for .onion requests', function () {
        const {Post} = require('../../../../../core/server/models/post');
        const filter = Post.prototype.enforcedFilters.call({}, {
            context: {public: true, isOnionRequest: true}
        });
        assert.ok(!filter.includes('onion_only'));
    });

    it('ghost-locals sets isOnionRequest correctly', function () {
        const ghostLocals = require('../../../../../core/server/web/parent/middleware/ghost-locals');
        const res = {locals: {}};
        ghostLocals({path: '/', hostname: 'abc123.onion'}, res, () => {});
        assert.equal(res.locals.isOnionRequest, true);

        const res2 = {locals: {}};
        ghostLocals({path: '/', hostname: 'alice.private-stack.dev'}, res2, () => {});
        assert.equal(res2.locals.isOnionRequest, false);
    });
});
