const logging = require('@tryghost/logging');

class SubscriberProvisioningService {
    /**
     * @param {Object} config
     * @param {string} [config.provider] - 'docker' or 'aca'
     * @param {Object} [config.dockerManager] - DockerManager instance (injected for testing)
     * @param {Object} [config.acaManager] - AcaManager instance (injected for testing)
     * @param {Function} [config.getKnex] - Function returning knex instance
     * @param {Object} [config.fs] - fs module for writing Caddyfile (docker mode only)
     * @param {Function} [config.execAsync] - promisified exec for Caddy reload (docker mode only)
     * @param {Object} [config.docker] - Options passed to DockerManager
     * @param {Object} [config.aca] - Options passed to AcaManager
     */
    constructor(config = {}) {
        const provider = config.provider || process.env.GHOST_CONTAINER_PROVIDER || 'docker';

        if (provider === 'aca') {
            if (config.acaManager) {
                this.manager = config.acaManager;
            } else {
                const AcaManager = require('./aca-manager');
                this.manager = new AcaManager(config.aca);
            }
            this._provider = 'aca';
        } else {
            if (config.dockerManager) {
                this.manager = config.dockerManager;
            } else {
                const DockerManager = require('./docker-manager');
                this.manager = new DockerManager(config.docker);
            }
            this._provider = 'docker';

            // Caddy config dependencies — only used in docker mode
            this.getKnex = config.getKnex || (() => require('../../data/db/connection'));
            this.fs = config.fs || require('fs-extra');
            this.execAsync = config.execAsync || require('util').promisify(require('child_process').exec);
        }
    }

    /**
     * Provision new subscriber container
     */
    async provisionSubscriber(subscriber) {
        logging.info(`Provisioning container for subscriber: ${subscriber.email || subscriber.username}`);

        const result = await this.manager.createSubscriberContainer(subscriber);

        if (this._provider === 'docker') {
            await this._updateCaddyConfig();
        }

        return result;
    }

    /**
     * Deprovision subscriber container
     */
    async deprovisionSubscriber(subscriberUsername) {
        logging.info(`Deprovisioning container for subscriber: ${subscriberUsername}`);

        await this.manager.deleteSubscriberContainer(subscriberUsername);

        if (this._provider === 'docker') {
            await this._updateCaddyConfig();
        }
    }

    /**
     * Update Caddy reverse proxy config — Docker mode only
     */
    async _updateCaddyConfig() {
        try {
            const knex = this.getKnex();
            const ConfigGenerator = require('./config-generator');

            const subscribers = await knex('subscribers')
                .where('status', 'running')
                .select('username', 'port', 'custom_domain');

            const caddyConfig = ConfigGenerator.generateCaddyConfig(subscribers);
            await this.fs.writeFile('Caddyfile', caddyConfig);
            await this.execAsync('curl -s -X POST http://localhost:2019/load -H "Content-Type: text/caddyfile" --data-binary @Caddyfile');

            logging.info('Caddy configuration reloaded successfully');
        } catch (error) {
            logging.error('Failed to reload Caddy:', error);
        }
    }
}

module.exports = SubscriberProvisioningService;
