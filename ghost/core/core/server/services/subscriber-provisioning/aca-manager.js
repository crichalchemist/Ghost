const crypto = require('crypto');
const logging = require('@tryghost/logging');

class AcaManager {
    /**
     * @param {Object} options
     * @param {Object} [options.containerAppsClient] - Azure ContainerAppsAPIClient (injected for testing)
     * @param {Object} [options.shareServiceClient] - Azure ShareServiceClient (injected for testing)
     * @param {Function} [options.getKnex] - Function returning knex instance (injected for testing)
     * @param {string} options.subscriptionId - Azure subscription ID
     * @param {string} [options.resourceGroup]
     * @param {string} [options.environmentName]
     * @param {string} [options.storageAccountName]
     * @param {string} [options.storageAccountKey]
     * @param {string} [options.location]
     * @param {string} [options.domain]
     * @param {string} [options.ghostImage]
     * @param {number} [options.cpu]
     * @param {string} [options.memoryGi]
     */
    constructor(options = {}) {
        if (options.containerAppsClient) {
            this.containerAppsClient = options.containerAppsClient;
        } else {
            const {ContainerAppsAPIClient} = require('@azure/arm-appcontainers');
            const {DefaultAzureCredential} = require('@azure/identity');
            this.containerAppsClient = new ContainerAppsAPIClient(
                new DefaultAzureCredential(),
                options.subscriptionId
            );
        }

        if (options.shareServiceClient) {
            this.shareServiceClient = options.shareServiceClient;
        } else {
            const {ShareServiceClient, StorageSharedKeyCredential} = require('@azure/storage-file-share');
            const credential = new StorageSharedKeyCredential(
                options.storageAccountName,
                options.storageAccountKey
            );
            this.shareServiceClient = new ShareServiceClient(
                `https://${options.storageAccountName}.file.core.windows.net`,
                credential
            );
        }

        this.getKnex = options.getKnex || (() => require('../../data/db/connection'));
        this.resourceGroup = options.resourceGroup || 'ghost-platform-rg';
        this.environmentName = options.environmentName || 'privatestack-env';
        this.storageAccountName = options.storageAccountName || 'privatestackstorage';
        this.storageAccountKey = options.storageAccountKey || '';
        this.location = options.location || 'francecentral';
        this.domain = options.domain || 'private-stack.dev';
        this.ghostImage = options.ghostImage || 'ghost:5-alpine';
        this.cpu = options.cpu || 0.5;
        this.memoryGi = options.memoryGi || '1Gi';
    }

    /**
     * Generate Ghost configuration for a subscriber
     * @param {Object} subscriber - {username, email}
     * @returns {Object} Ghost config object
     */
    generateGhostConfig(subscriber) {
        return {
            url: `https://${subscriber.username}.${this.domain}`,
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
                    auth: {user: 'test', pass: 'test'}
                }
            },
            privacy: {
                useUpdateCheck: false
            }
        };
    }

    /**
     * Create an Azure File Share and upload Ghost config
     * @param {string} shareName - Name of the file share
     * @param {Object} ghostConfig - Ghost configuration object
     */
    async _createFileShare(shareName, ghostConfig) {
        const shareClient = this.shareServiceClient.getShareClient(shareName);
        await shareClient.create();

        const dirClient = shareClient.getDirectoryClient('');
        const configContent = JSON.stringify(ghostConfig, null, 2);
        const fileClient = dirClient.getFileClient('config.production.json');
        await fileClient.create(configContent.length);
        await fileClient.uploadRange(configContent, 0, configContent.length);
    }

    /**
     * Create a subscriber container app on Azure Container Apps
     * @param {Object} subscriber - {id, email, username, custom_domain}
     * @returns {Promise<{containerAppName, fqdn, url, customDomain, subscriberId}>}
     */
    async createSubscriberContainer(subscriber) {
        const containerAppName = `ghost-sub-${subscriber.username}`;
        const shareName = `ghost-${subscriber.username}`;

        try {
            const ghostConfig = this.generateGhostConfig(subscriber);
            await this._createFileShare(shareName, ghostConfig);

            const subscriptionId = this.containerAppsClient.subscriptionId || '';
            const managedEnvironmentId = `/subscriptions/${subscriptionId}/resourceGroups/${this.resourceGroup}/providers/Microsoft.App/managedEnvironments/${this.environmentName}`;

            const containerAppEnvelope = {
                location: this.location,
                managedEnvironmentId,
                configuration: {
                    ingress: {
                        external: true,
                        targetPort: 2368,
                        transport: 'auto'
                    },
                    secrets: [{
                        name: 'storage-key',
                        value: this.storageAccountKey
                    }]
                },
                template: {
                    containers: [{
                        name: 'ghost',
                        image: this.ghostImage,
                        resources: {
                            cpu: this.cpu,
                            memory: this.memoryGi
                        },
                        env: [
                            {name: 'NODE_ENV', value: 'production'},
                            {name: 'url', value: `https://${subscriber.username}.${this.domain}`}
                        ],
                        volumeMounts: [{
                            volumeName: 'ghost-content',
                            mountPath: '/var/lib/ghost/content'
                        }]
                    }],
                    scale: {
                        minReplicas: 1,
                        maxReplicas: 1
                    },
                    volumes: [{
                        name: 'ghost-content',
                        storageName: shareName,
                        storageType: 'AzureFile'
                    }]
                }
            };

            const result = await this.containerAppsClient.containerApps.beginCreateOrUpdateAndWait(
                this.resourceGroup,
                containerAppName,
                containerAppEnvelope
            );

            const fqdn = result.properties?.configuration?.ingress?.fqdn || '';

            const knex = this.getKnex();
            const subscriberId = crypto.randomUUID();

            await knex('subscribers').insert({
                id: subscriberId,
                member_id: subscriber.id,
                username: subscriber.username,
                custom_domain: subscriber.custom_domain,
                container_id: containerAppName,
                port: 2368,
                status: 'running',
                metadata: JSON.stringify({fqdn}),
                created_at: new Date(),
                updated_at: new Date()
            });

            await knex('subscriber_container_events').insert({
                subscriber_id: subscriberId,
                event_type: 'created',
                details: JSON.stringify({containerAppName, fqdn}),
                created_at: new Date()
            });

            logging.info(`Created ACA container for subscriber: ${subscriber.username} — ${fqdn}`);

            return {
                containerAppName,
                fqdn,
                url: `https://${subscriber.username}.${this.domain}`,
                customDomain: subscriber.custom_domain || null,
                subscriberId
            };
        } catch (error) {
            logging.error('Error creating ACA subscriber container:', error);
            throw error;
        }
    }

    /**
     * Delete a subscriber container app and clean up resources
     * @param {string} subscriberUsername - Username of the subscriber
     */
    async deleteSubscriberContainer(subscriberUsername) {
        const knex = this.getKnex();
        const containerAppName = `ghost-sub-${subscriberUsername}`;
        const shareName = `ghost-${subscriberUsername}`;

        const subscriber = await knex('subscribers')
            .where('username', subscriberUsername)
            .first();

        if (!subscriber) {
            throw new Error(`Subscriber not found: ${subscriberUsername}`);
        }

        await this.containerAppsClient.containerApps.beginDeleteAndWait(
            this.resourceGroup,
            containerAppName
        );

        const shareClient = this.shareServiceClient.getShareClient(shareName);
        await shareClient.delete();

        await knex('subscriber_container_events').insert({
            subscriber_id: subscriber.id,
            event_type: 'deleted',
            details: JSON.stringify({containerAppName}),
            created_at: new Date()
        });

        await knex('subscribers')
            .where('username', subscriberUsername)
            .delete();

        logging.info(`Deleted ACA container for subscriber: ${subscriberUsername}`);
    }

    /**
     * Get the status of a subscriber's container app
     * @param {string} subscriberUsername - Username of the subscriber
     * @returns {Promise<{provisioningState, runningStatus}>}
     */
    async getSubscriberStatus(subscriberUsername) {
        const containerAppName = `ghost-sub-${subscriberUsername}`;

        const app = await this.containerAppsClient.containerApps.get(
            this.resourceGroup,
            containerAppName
        );

        return {
            provisioningState: app.properties?.provisioningState,
            runningStatus: app.properties?.runningStatus
        };
    }
}

module.exports = AcaManager;
