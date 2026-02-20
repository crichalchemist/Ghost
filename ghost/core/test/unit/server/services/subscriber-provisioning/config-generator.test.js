const assert = require('node:assert/strict');

describe('ConfigGenerator', function () {
    let ConfigGenerator;

    before(function () {
        ConfigGenerator = require('../../../../../core/server/services/subscriber-provisioning/config-generator');
    });

    describe('generateCaddyConfig', function () {
        it('should generate main domain block routing to Ghost on port 2368', function () {
            const config = ConfigGenerator.generateCaddyConfig([]);

            assert.ok(config.includes('private-stack.dev {'), 'Should have main domain block');
            assert.ok(config.includes('reverse_proxy localhost:2368'), 'Should proxy to Ghost on 2368');
            assert.ok(config.includes('encode gzip'), 'Should enable gzip');
        });

        it('should generate a single wildcard block for all subscriber subdomains', function () {
            const subscribers = [
                {username: 'alice', port: 2370},
                {username: 'bob', port: 2371}
            ];

            const config = ConfigGenerator.generateCaddyConfig(subscribers);

            // Should have exactly ONE *.private-stack.dev block, not one per subscriber
            const wildcardMatches = config.match(/\*\.private-stack\.dev \{/g);
            assert.equal(wildcardMatches.length, 1, 'Should have exactly one wildcard block');
        });

        it('should use named matchers for each subscriber inside the wildcard block', function () {
            const subscribers = [
                {username: 'alice', port: 2370},
                {username: 'bob', port: 2371}
            ];

            const config = ConfigGenerator.generateCaddyConfig(subscribers);

            // Each subscriber gets a named matcher and handle directive
            assert.ok(config.includes('@subscriber_0 host alice.private-stack.dev'), 'alice matcher');
            assert.ok(config.includes('handle @subscriber_0 {'), 'alice handle');
            assert.ok(config.includes('reverse_proxy localhost:2370'), 'alice proxy');

            assert.ok(config.includes('@subscriber_1 host bob.private-stack.dev'), 'bob matcher');
            assert.ok(config.includes('handle @subscriber_1 {'), 'bob handle');
            assert.ok(config.includes('reverse_proxy localhost:2371'), 'bob proxy');
        });

        it('should include fallback 404 for unknown subdomains', function () {
            const config = ConfigGenerator.generateCaddyConfig([{username: 'alice', port: 2370}]);

            assert.ok(config.includes('handle {'), 'Should have fallback handle');
            assert.ok(config.includes('respond "Subscriber not found" 404'), 'Should respond 404');
        });

        it('should generate custom domain blocks for subscribers that have one', function () {
            const subscribers = [
                {username: 'alice', port: 2370, custom_domain: 'alice-blog.com'},
                {username: 'bob', port: 2371} // no custom domain
            ];

            const config = ConfigGenerator.generateCaddyConfig(subscribers);

            assert.ok(config.includes('alice-blog.com {'), 'Should have custom domain block');
            // The custom domain block should proxy to the same port
            assert.ok(config.includes('alice-blog.com {\n    encode gzip\n    reverse_proxy localhost:2370\n}'),
                'Custom domain should proxy to subscriber port');
            // bob has no custom domain — no extra block for bob
            assert.ok(!config.includes('bob.com'), 'Should not have block for subscriber without custom domain');
        });

        it('should handle empty subscriber list', function () {
            const config = ConfigGenerator.generateCaddyConfig([]);

            // Should still have main domain and wildcard with fallback
            assert.ok(config.includes('private-stack.dev {'), 'Main domain present');
            assert.ok(config.includes('*.private-stack.dev {'), 'Wildcard block present');
            assert.ok(config.includes('respond "Subscriber not found" 404'), 'Fallback present');
        });
    });
});
