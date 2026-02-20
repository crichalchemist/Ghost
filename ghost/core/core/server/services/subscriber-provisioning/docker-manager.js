const path = require('path');
const crypto = require('crypto');
const logging = require('@tryghost/logging');

class DockerManager {
    /**
     * @param {Object} options
     * @param {Object} [options.docker] - Dockerode instance (injected for testing)
     * @param {Object} [options.fs] - fs-extra module (injected for testing)
     * @param {Function} [options.getKnex] - Function returning knex instance (injected for testing)
     * @param {string} [options.subscribersPath]
     * @param {number} [options.basePort]
     * @param {string} [options.network]
     */
    constructor(options = {}) {
        const Docker = require('dockerode');
        const fsExtra = require('fs-extra');
        this.docker = options.docker || new Docker({socketPath: '/var/run/docker.sock'});
        this.fs = options.fs || fsExtra;
        this.getKnex = options.getKnex || (() => require('../../data/db/connection'));
        this.subscribersPath = options.subscribersPath || '/home/crichalchemist/subscribers';
        this.basePort = options.basePort || 2370;
        this.network = options.network || 'privatestack-subscribers';
    }

    /**
     * Ensure Docker network exists for subscriber containers
     */
    async ensureNetwork() {
        try {
            await this.docker.getNetwork(this.network).inspect();
        } catch (error) {
            await this.docker.createNetwork({
                Name: this.network,
                Driver: 'bridge'
            });
            logging.info(`Created Docker network: ${this.network}`);
        }
    }

    /**
     * Get next available port for subscriber container
     */
    async getNextAvailablePort() {
        const containers = await this.docker.listContainers({all: true});
        const usedPorts = containers
            .filter(c => c.Labels?.['subscriber.port'])
            .map(c => parseInt(c.Labels['subscriber.port']));

        let port = this.basePort;
        while (usedPorts.includes(port)) {
            port++;
        }
        return port;
    }

    /**
     * Create subscriber container
     * @param {Object} subscriber - {id, email, username, custom_domain}
     * @returns {Promise<{container, port, url, customDomain, subscriberId}>}
     */
    async createSubscriberContainer(subscriber) {
        try {
            await this.ensureNetwork();

            const port = await this.getNextAvailablePort();
            const subscriberDir = path.join(this.subscribersPath, subscriber.username);

            // Create subscriber directory
            await this.fs.ensureDir(subscriberDir);
            await this.fs.ensureDir(path.join(subscriberDir, 'content'));

            // Generate config — written as production config
            const config = this.generateConfig(subscriber, port);
            await this.fs.writeFile(
                path.join(subscriberDir, 'config.production.json'),
                JSON.stringify(config, null, 2)
            );

            // Create Docker container
            // Ghost listens on 2368 internally — we map that to the dynamic host port
            const container = await this.docker.createContainer({
                Image: 'ghost:latest',
                name: `ghost-subscriber-${subscriber.username}`,
                Hostname: subscriber.username,
                Labels: {
                    'subscriber.id': subscriber.id,
                    'subscriber.username': subscriber.username,
                    'subscriber.port': port.toString(),
                    'subscriber.email': subscriber.email || '',
                    'managed': 'true'
                },
                Env: [
                    'NODE_ENV=production',
                    `url=https://${subscriber.username}.private-stack.dev`
                ],
                ExposedPorts: {
                    '2368/tcp': {}
                },
                HostConfig: {
                    PortBindings: {
                        '2368/tcp': [{HostPort: port.toString()}]
                    },
                    Binds: [
                        `${subscriberDir}/content:/var/lib/ghost/content`,
                        `${subscriberDir}/config.production.json:/var/lib/ghost/config.production.json`
                    ],
                    RestartPolicy: {
                        Name: 'unless-stopped',
                        MaximumRetryCount: 5
                    },
                    Memory: 512 * 1024 * 1024,
                    MemorySwap: 1024 * 1024 * 1024,
                    NetworkMode: this.network
                }
            });

            await container.start();

            // Write subscriber record to database
            const knex = this.getKnex();
            const subscriberId = crypto.randomUUID();

            await knex('subscribers').insert({
                id: subscriberId,
                member_id: subscriber.id,
                username: subscriber.username,
                custom_domain: subscriber.custom_domain,
                container_id: container.id,
                port: port,
                status: 'running',
                metadata: JSON.stringify({}),
                created_at: new Date(),
                updated_at: new Date()
            });

            await knex('subscriber_container_events').insert({
                subscriber_id: subscriberId,
                event_type: 'created',
                details: JSON.stringify({port, container_id: container.id}),
                created_at: new Date()
            });

            logging.info(`Created Ghost container for subscriber: ${subscriber.username} on port ${port}`);

            return {
                container: container.id,
                port,
                url: `https://${subscriber.username}.private-stack.dev`,
                customDomain: subscriber.custom_domain || null,
                subscriberId
            };
        } catch (error) {
            logging.error('Error creating subscriber container:', error);
            throw error;
        }
    }

    /**
     * Delete subscriber container with full cleanup
     */
    async deleteSubscriberContainer(subscriberUsername) {
        const knex = this.getKnex();

        // Look up subscriber in database first
        const subscriber = await knex('subscribers')
            .where('username', subscriberUsername)
            .first();

        if (!subscriber) {
            throw new Error(`Subscriber not found: ${subscriberUsername}`);
        }

        // Stop and remove Docker container
        const container = this.docker.getContainer(`ghost-subscriber-${subscriberUsername}`);
        await container.stop();
        await container.remove();

        // Log deletion event
        await knex('subscriber_container_events').insert({
            subscriber_id: subscriber.id,
            event_type: 'deleted',
            details: JSON.stringify({container_id: subscriber.container_id}),
            created_at: new Date()
        });

        // Remove from database
        await knex('subscribers')
            .where('username', subscriberUsername)
            .delete();

        // Clean up filesystem
        const subscriberDir = path.join(this.subscribersPath, subscriberUsername);
        await this.fs.remove(subscriberDir);

        logging.info(`Deleted Ghost container for subscriber: ${subscriberUsername}`);
    }

    /**
     * Generate Ghost config for subscriber
     * Port is always 2368 (Ghost's internal port) — host port mapping is separate
     */
    generateConfig(subscriber, _hostPort) {
        return {
            url: `https://${subscriber.username}.private-stack.dev`,
            port: 2368,
            database: {
                client: 'sqlite3',
                connection: {
                    filename: `/var/lib/ghost/content/data/ghost-${subscriber.username}.db`
                }
            },
            mail: {
                transport: 'SMTP',
                options: {
                    host: '127.0.0.1',
                    port: 1025,
                    auth: {
                        user: 'test',
                        pass: 'test'
                    }
                }
            },
            privacy: {
                useUpdateCheck: false
            }
        };
    }
}

module.exports = DockerManager;
