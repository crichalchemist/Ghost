class ConfigGenerator {
    /**
     * Generate Caddy config for all subscribers
     * Uses a single wildcard block with named matchers (correct Caddy syntax)
     */
    static generateCaddyConfig(subscribers) {
        let config = '# Auto-generated Caddy config for PrivateStack subscribers\n\n';

        // Main domain
        config += 'private-stack.dev {\n';
        config += '    encode gzip\n';
        config += '    reverse_proxy localhost:2368\n';
        config += '}\n\n';

        // Single wildcard block with matchers for each subscriber
        config += '*.private-stack.dev {\n';
        config += '    encode gzip\n\n';

        subscribers.forEach((sub, index) => {
            config += `    @subscriber_${index} host ${sub.username}.private-stack.dev\n`;
            config += `    handle @subscriber_${index} {\n`;
            config += `        reverse_proxy localhost:${sub.port}\n`;
            config += '    }\n\n';
        });

        // Fallback for unknown subdomains
        config += '    handle {\n';
        config += '        respond "Subscriber not found" 404\n';
        config += '    }\n';
        config += '}\n\n';

        // Custom domains
        subscribers.forEach((sub) => {
            if (sub.custom_domain) {
                config += `${sub.custom_domain} {\n`;
                config += '    encode gzip\n';
                config += `    reverse_proxy localhost:${sub.port}\n`;
                config += '}\n\n';
            }
        });

        return config;
    }
}

module.exports = ConfigGenerator;
