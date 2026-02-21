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
     * @param {Object} [options.smtp] - SMTP configuration for subscriber mail
     * @param {string} [options.smtp.host] - SMTP relay host (e.g. rentfall private IP)
     * @param {number} [options.smtp.port] - SMTP relay port
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
        this.smtp = {
            host: (options.smtp && options.smtp.host) || '10.0.0.4',
            port: (options.smtp && options.smtp.port) || 587
        };
    }

    /**
     * Generate Ghost configuration for a subscriber
     * @param {Object} subscriber - {username, email}
     * @returns {Object} Ghost config object
     */
    generateGhostConfig(subscriber) {
        const config = require('../../../shared/config');
        const tinybirdConfig = config.get('tinybird');

        const ghostConfig = {
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
                    host: this.smtp.host,
                    port: this.smtp.port
                }
            },
            privacy: {
                useUpdateCheck: false
            }
        };

        // Inherit tinybird analytics from main site config
        // Subscribers share the workspace — site_uuid provides per-site isolation
        if (tinybirdConfig && tinybirdConfig.workspaceId) {
            ghostConfig.tinybird = {
                workspaceId: tinybirdConfig.workspaceId,
                adminToken: tinybirdConfig.adminToken,
                tracker: {
                    endpoint: '/.ghost/analytics/api/v1/page_hit'
                },
                stats: tinybirdConfig.stats
            };
        }

        return ghostConfig;
    }

    /**
     * Create an Azure File Share, upload Ghost config, and register
     * the share as a storage resource in the ACA environment.
     * @param {string} shareName - Name of the file share
     * @param {Object} ghostConfig - Ghost configuration object
     */
    async _createFileShare(shareName, ghostConfig) {
        // 1. Create the file share in Azure Storage
        const shareClient = this.shareServiceClient.getShareClient(shareName);
        await shareClient.create();

        // 2. Upload Ghost config
        const dirClient = shareClient.getDirectoryClient('');
        const configContent = JSON.stringify(ghostConfig, null, 2);
        const configBuffer = Buffer.from(configContent, 'utf8');
        const fileClient = dirClient.getFileClient('config.production.json');
        await fileClient.create(configBuffer.length);
        await fileClient.uploadRange(configBuffer, 0, configBuffer.length);

        // 3. Register the share as a named storage in the ACA environment
        await this.containerAppsClient.managedEnvironmentsStorages.createOrUpdate(
            this.resourceGroup,
            this.environmentName,
            shareName,
            {
                properties: {
                    azureFile: {
                        accountName: this.storageAccountName,
                        accountKey: this.storageAccountKey,
                        shareName: shareName,
                        accessMode: 'ReadWrite'
                    }
                }
            }
        );
    }

    /**
     * Create a subscriber container app on Azure Container Apps
     * @param {Object} subscriber - {id, email, username, custom_domain}
     * @returns {Promise<{containerAppName, fqdn, url, customDomain, subscriberId}>}
     */
    async createSubscriberContainer(subscriber) {
        if (!subscriber.username || !/^[a-z][a-z0-9-]{0,20}$/.test(subscriber.username)) {
            throw new Error(
                `Invalid username "${subscriber.username}": must be 1-21 lowercase alphanumeric characters or hyphens, starting with a letter`
            );
        }

        const containerAppName = `ghost-sub-${subscriber.username}`;
        const shareName = `ghost-${subscriber.username}`;

        try {
            const ghostConfig = this.generateGhostConfig(subscriber);
            await this._createFileShare(shareName, ghostConfig);

            const subscriptionId = this.containerAppsClient.subscriptionId || '';
            const managedEnvironmentId = `/subscriptions/${subscriptionId}/resourceGroups/${this.resourceGroup}/providers/Microsoft.App/managedEnvironments/${this.environmentName}`;

            // Custom domain binding requires DNS validation + managed cert provisioning.
            // This is a separate step after the container is created and DNS is configured.
            // See addCustomDomain() method.

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

            const fqdn = result.configuration?.ingress?.fqdn || '';

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

            // Best-effort cleanup of partially provisioned resources
            try {
                const shareClient = this.shareServiceClient.getShareClient(shareName);
                await shareClient.delete();
                logging.info(`Cleaned up orphaned file share: ${shareName}`);
            } catch (cleanupError) {
                logging.error(`Failed to clean up file share ${shareName}:`, cleanupError);
            }

            try {
                await this.containerAppsClient.containerApps.beginDeleteAndWait(
                    this.resourceGroup,
                    containerAppName
                );
                logging.info(`Cleaned up orphaned container app: ${containerAppName}`);
            } catch (cleanupError) {
                // Container may not have been created yet, 404 is expected
                if (!cleanupError.statusCode || cleanupError.statusCode !== 404) {
                    logging.error(`Failed to clean up container app ${containerAppName}:`, cleanupError);
                }
            }

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

        const errors = [];

        try {
            await this.containerAppsClient.containerApps.beginDeleteAndWait(
                this.resourceGroup,
                containerAppName
            );
        } catch (error) {
            logging.error(`Failed to delete container app ${containerAppName}:`, error);
            errors.push(error);
        }

        try {
            await this.containerAppsClient.managedEnvironmentsStorages.delete(
                this.resourceGroup,
                this.environmentName,
                shareName
            );
        } catch (error) {
            logging.error(`Failed to deregister env storage ${shareName}:`, error);
            errors.push(error);
        }

        try {
            const shareClient = this.shareServiceClient.getShareClient(shareName);
            await shareClient.delete();
        } catch (error) {
            logging.error(`Failed to delete file share ${shareName}:`, error);
            errors.push(error);
        }

        // Always log event and remove DB record, even if cloud cleanup partially failed
        await knex('subscriber_container_events').insert({
            subscriber_id: subscriber.id,
            event_type: 'deleted',
            details: JSON.stringify({containerAppName, errors: errors.map(e => e.message)}),
            created_at: new Date()
        });

        await knex('subscribers')
            .where('username', subscriberUsername)
            .delete();

        logging.info(`Deleted ACA container for subscriber: ${subscriberUsername}`);

        if (errors.length > 0) {
            logging.warn(`Deletion completed with ${errors.length} error(s) for ${subscriberUsername}`);
        }
    }

    /**
     * Add a custom domain binding to an existing container app.
     * Requires DNS CNAME to be configured pointing to the ACA FQDN first.
     * @param {string} subscriberUsername - Username of the subscriber
     * @param {string} domainName - Custom domain to bind (e.g. 'alice.private-stack.dev')
     * @param {string} [certificateId] - Managed certificate ID (omit for auto-provisioning)
     */
    async addCustomDomain(subscriberUsername, domainName, certificateId) {
        const containerAppName = `ghost-sub-${subscriberUsername}`;

        const app = await this.containerAppsClient.containerApps.get(
            this.resourceGroup,
            containerAppName
        );

        const existingDomains = app.configuration?.ingress?.customDomains || [];
        existingDomains.push({
            name: domainName,
            bindingType: certificateId ? 'SniEnabled' : 'Disabled',
            certificateId: certificateId || undefined
        });

        await this.containerAppsClient.containerApps.beginCreateOrUpdateAndWait(
            this.resourceGroup,
            containerAppName,
            {
                ...app,
                configuration: {
                    ...app.configuration,
                    ingress: {
                        ...app.configuration.ingress,
                        customDomains: existingDomains
                    }
                }
            }
        );

        logging.info(`Added custom domain ${domainName} to ${containerAppName}`);
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
            provisioningState: app.provisioningState,
            runningStatus: app.runningStatus
        };
    }
}

module.exports = AcaManager;
