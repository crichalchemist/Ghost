const logging = require('@tryghost/logging');
const DockerManager = require('./docker-manager');
const ConfigGenerator = require('./config-generator');

class SubscriberProvisioningService {
    /**
     * @param {Object} config
     * @param {Object} [config.dockerManager] - DockerManager instance (injected for testing)
     * @param {Function} [config.getKnex] - Function returning knex instance
     * @param {Object} [config.fs] - fs module for writing Caddyfile
     * @param {Function} [config.execAsync] - promisified exec for Caddy reload
     * @param {Object} [config.docker] - Options passed to DockerManager
     */
    constructor(config = {}) {
        this.dockerManager = config.dockerManager || new DockerManager(config.docker);
        this.getKnex = config.getKnex || (() => require('../../data/db/connection'));
        this.fs = config.fs || require('fs-extra');
        this.execAsync = config.execAsync || require('util').promisify(require('child_process').exec);
    }

    /**
     * Provision new subscriber container
     */
    async provisionSubscriber(subscriber) {
        logging.info(`Provisioning container for subscriber: ${subscriber.email || subscriber.username}`);

        const result = await this.dockerManager.createSubscriberContainer(subscriber);

        await this.updateCaddyConfig();

        return result;
    }

    /**
     * Deprovision subscriber container
     */
    async deprovisionSubscriber(subscriberUsername) {
        logging.info(`Deprovisioning container for subscriber: ${subscriberUsername}`);

        await this.dockerManager.deleteSubscriberContainer(subscriberUsername);

        await this.updateCaddyConfig();
    }

    /**
     * Update Caddy reverse proxy config from current database state
     */
    async updateCaddyConfig() {
        try {
            const knex = this.getKnex();

            // Fetch all running subscribers
            const subscribers = await knex('subscribers')
                .where('status', 'running')
                .select('username', 'port', 'custom_domain');

            // Generate Caddy config
            const caddyConfig = ConfigGenerator.generateCaddyConfig(subscribers);

            // Write to Caddyfile
            await this.fs.writeFile('Caddyfile', caddyConfig);

            // Reload Caddy via admin API
            await this.execAsync('curl -s -X POST http://localhost:2019/load -H "Content-Type: text/caddyfile" --data-binary @Caddyfile');

            logging.info('Caddy configuration reloaded successfully');
        } catch (error) {
            logging.error('Failed to reload Caddy:', error);
            // Don't throw — provisioning should succeed even if Caddy reload fails
        }
    }
}

module.exports = SubscriberProvisioningService;
