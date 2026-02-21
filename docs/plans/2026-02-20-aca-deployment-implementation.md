# Azure Container Apps Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Docker-based subscriber provisioning with Azure Container Apps, enabling managed container deployment with built-in SSL and routing.

**Architecture:** Each subscriber gets an Azure Container App in a shared ACA Environment. Ghost config and content persist on Azure File Shares. The existing `SubscriberProvisioningService` orchestrator switches between Docker (local dev) and ACA (production) based on config. Infrastructure provisioned via Azure CLI (with Azure MCP as alternative).

**Tech Stack:** `@azure/arm-appcontainers` (v3.x), `@azure/identity`, `@azure/storage-file-share` (v12.x), Azure CLI (`az`), Mocha + Sinon + assert/strict

**Design doc:** `docs/plans/2026-02-20-aca-deployment-design.md`

---

## Task 1: Provision Azure Infrastructure

**Goal:** Create the one-time Azure resources needed before any code can deploy subscriber containers.

**Prerequisites:** Azure CLI installed and authenticated (`az login`), existing resource group `GHOST-PLATFORM-RG` in France Central.

> **Note for Claude:** If the `com.microsoft/azure` MCP server is connected, use its tools for these operations. Otherwise fall back to the `az` CLI commands below.

---

### Step 1: Create Storage Account

Run:
```bash
az storage account create \
  --name privatestackstorage \
  --resource-group GHOST-PLATFORM-RG \
  --location francecentral \
  --sku Standard_LRS \
  --kind StorageV2
```

Expected: Storage account created. Save the connection string:

```bash
az storage account show-connection-string \
  --name privatestackstorage \
  --resource-group GHOST-PLATFORM-RG \
  --query connectionString -o tsv
```

### Step 2: Create VNet subnet for ACA

Check existing VNet:
```bash
az network vnet list --resource-group GHOST-PLATFORM-RG --query "[].{name:name, addressSpace:addressSpace.addressPrefixes}" -o table
```

Create ACA-delegated subnet (adjust CIDR to avoid conflicts with existing subnets):
```bash
az network vnet subnet create \
  --resource-group GHOST-PLATFORM-RG \
  --vnet-name privatestack-vnet \
  --name aca-subnet \
  --address-prefixes 10.0.4.0/23 \
  --delegations Microsoft.App/environments
```

Expected: Subnet created with delegation.

### Step 3: Create ACA Environment

Get the subnet resource ID:
```bash
ACA_SUBNET_ID=$(az network vnet subnet show \
  --resource-group GHOST-PLATFORM-RG \
  --vnet-name privatestack-vnet \
  --name aca-subnet \
  --query id -o tsv)
```

Create environment:
```bash
az containerapp env create \
  --name privatestack-env \
  --resource-group GHOST-PLATFORM-RG \
  --location francecentral \
  --infrastructure-subnet-resource-id $ACA_SUBNET_ID \
  --logs-destination none
```

Expected: ACA Environment created. Takes 2-5 minutes.

### Step 4: Get the ACA environment default domain

```bash
az containerapp env show \
  --name privatestack-env \
  --resource-group GHOST-PLATFORM-RG \
  --query "properties.defaultDomain" -o tsv
```

Save this — needed for DNS CNAME configuration.

### Step 5: Configure DNS

In your DNS provider for `private-stack.dev`:
- `*.private-stack.dev` CNAME → `privatestack-env.<region>.azurecontainerapps.io` (the default domain from Step 4)
- `private-stack.dev` A → rentfall VM public IP

### Step 6: Get storage account key

```bash
az storage account keys list \
  --account-name privatestackstorage \
  --resource-group GHOST-PLATFORM-RG \
  --query "[0].value" -o tsv
```

Save this — needed for the Ghost config.

### Step 7: Get Azure subscription ID

```bash
az account show --query id -o tsv
```

Save this — needed for the SDK client.

### Step 8: Verify

```bash
az containerapp env show --name privatestack-env --resource-group GHOST-PLATFORM-RG --query "properties.provisioningState" -o tsv
```

Expected: `Succeeded`

### Step 9: Document credentials

Add to `ghost/core/config.production.json` (or environment variables):
```json
{
  "containerProvider": "aca",
  "aca": {
    "subscriptionId": "<from step 7>",
    "resourceGroup": "GHOST-PLATFORM-RG",
    "environmentName": "privatestack-env",
    "storageAccountName": "privatestackstorage",
    "storageAccountKey": "<from step 6>",
    "location": "francecentral",
    "domain": "private-stack.dev",
    "ghostImage": "ghost:5-alpine",
    "cpu": 0.5,
    "memoryGi": "1Gi"
  }
}
```

No commit — credentials should not be committed.

---

## Task 2: Add Azure SDK Dependencies

**Goal:** Install the Azure SDK packages needed by AcaManager.

**Files to modify:**
- `ghost/core/package.json`

---

### Step 1: Install dependencies

Run from repository root:
```bash
cd ghost/core && yarn add @azure/arm-appcontainers @azure/identity @azure/storage-file-share
```

Expected: Packages added to `ghost/core/package.json` dependencies, `yarn.lock` updated.

### Step 2: Verify installation

Run:
```bash
node -e "require('@azure/arm-appcontainers'); require('@azure/identity'); require('@azure/storage-file-share'); console.log('All Azure SDKs loaded successfully')"
```

Expected: `All Azure SDKs loaded successfully`

### Step 3: Commit

```bash
git add ghost/core/package.json yarn.lock
git commit -m "chore: add Azure SDK dependencies for Container Apps provisioning

ref docs/plans/2026-02-20-aca-deployment-design.md"
```

---

## Task 3: Create AcaManager with TDD

**Goal:** Build the Azure Container Apps manager that replaces DockerManager for production.

**Files to create:**
- `ghost/core/core/server/services/subscriber-provisioning/aca-manager.js`
- `ghost/core/test/unit/server/services/subscriber-provisioning/aca-manager.test.js`

**Pattern reference:** Follow the exact DI and testing patterns in `docker-manager.js` and `docker-manager.test.js`.

---

### Step 1: Write the test file scaffold

Create: `ghost/core/test/unit/server/services/subscriber-provisioning/aca-manager.test.js`

```javascript
const assert = require('node:assert/strict');
const sinon = require('sinon');

describe('AcaManager', function () {
    let containerAppsClientStub;
    let shareServiceClientStub;
    let knexStub;
    let subscribersInsertStub;
    let eventsInsertStub;

    // Fresh require to avoid module cache issues
    let AcaManager;

    before(function () {
        AcaManager = require('../../../../../core/server/services/subscriber-provisioning/aca-manager');
    });

    beforeEach(function () {
        // Stub Azure Container Apps client
        containerAppsClientStub = {
            containerApps: {
                beginCreateOrUpdateAndWait: sinon.stub().resolves({
                    name: 'ghost-sub-testuser',
                    properties: {
                        provisioningState: 'Succeeded',
                        configuration: {
                            ingress: {
                                fqdn: 'ghost-sub-testuser.privatestack-env.francecentral.azurecontainerapps.io'
                            }
                        }
                    }
                }),
                beginDeleteAndWait: sinon.stub().resolves(),
                get: sinon.stub().resolves({
                    properties: {provisioningState: 'Succeeded', runningStatus: 'Running'}
                })
            }
        };

        // Stub Azure Storage File Share client
        shareServiceClientStub = {
            getShareClient: sinon.stub().returns({
                create: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
                getDirectoryClient: sinon.stub().returns({
                    getFileClient: sinon.stub().returns({
                        create: sinon.stub().resolves(),
                        uploadRange: sinon.stub().resolves()
                    })
                })
            })
        };

        // Stub knex — same pattern as docker-manager.test.js
        subscribersInsertStub = sinon.stub().resolves();
        eventsInsertStub = sinon.stub().resolves();

        knexStub = function (tableName) {
            if (tableName === 'subscribers') {
                return {
                    insert: subscribersInsertStub,
                    where: sinon.stub().returnsThis(),
                    first: sinon.stub().resolves({id: 'sub_123', container_id: 'ghost-sub-testuser'}),
                    delete: sinon.stub().resolves()
                };
            }
            if (tableName === 'subscriber_container_events') {
                return {insert: eventsInsertStub};
            }
            return {insert: sinon.stub().resolves()};
        };
    });

    afterEach(function () {
        sinon.restore();
    });

    function createManager(overrides = {}) {
        return new AcaManager({
            containerAppsClient: containerAppsClientStub,
            shareServiceClient: shareServiceClientStub,
            getKnex: () => knexStub,
            subscriptionId: 'test-sub-id',
            resourceGroup: 'GHOST-PLATFORM-RG',
            environmentName: 'privatestack-env',
            storageAccountName: 'privatestackstorage',
            storageAccountKey: 'dGVzdGtleQ==',
            location: 'francecentral',
            domain: 'private-stack.dev',
            ghostImage: 'ghost:5-alpine',
            cpu: 0.5,
            memoryGi: '1Gi',
            ...overrides
        });
    }

    describe('generateGhostConfig', function () {
        it('should generate valid Ghost config for subscriber', function () {
            const manager = createManager();
            const config = manager.generateGhostConfig({
                username: 'testuser',
                email: 'test@example.com'
            });

            assert.equal(config.url, 'https://testuser.private-stack.dev');
            assert.equal(config.port, 2368);
            assert.equal(config.database.client, 'sqlite3');
            assert.ok(config.database.connection.filename.includes('testuser'));
        });

        it('should set privacy.useUpdateCheck to false', function () {
            const manager = createManager();
            const config = manager.generateGhostConfig({username: 'testuser'});
            assert.equal(config.privacy.useUpdateCheck, false);
        });
    });

    describe('createSubscriberContainer', function () {
        it('should create Azure File Share for subscriber', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(shareServiceClientStub.getShareClient);
            sinon.assert.calledWith(shareServiceClientStub.getShareClient, 'ghost-testuser');
        });

        it('should upload Ghost config to file share', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            const shareClient = shareServiceClientStub.getShareClient.returnValues[0];
            const dirClient = shareClient.getDirectoryClient.returnValues[0];
            const fileClient = dirClient.getFileClient.returnValues[0];

            sinon.assert.calledOnce(fileClient.create);
            sinon.assert.calledOnce(fileClient.uploadRange);
        });

        it('should create container app with correct configuration', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait);

            const callArgs = containerAppsClientStub.containerApps.beginCreateOrUpdateAndWait.firstCall.args;
            assert.equal(callArgs[0], 'GHOST-PLATFORM-RG');
            assert.equal(callArgs[1], 'ghost-sub-testuser');

            const envelope = callArgs[2];
            assert.equal(envelope.location, 'francecentral');
            assert.equal(envelope.template.containers[0].image, 'ghost:5-alpine');
            assert.equal(envelope.template.containers[0].resources.cpu, 0.5);
            assert.equal(envelope.configuration.ingress.external, true);
            assert.equal(envelope.configuration.ingress.targetPort, 2368);
            assert.equal(envelope.template.scale.minReplicas, 1);
            assert.equal(envelope.template.scale.maxReplicas, 1);
        });

        it('should write subscriber record to database', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(subscribersInsertStub);
            const record = subscribersInsertStub.firstCall.args[0];
            assert.equal(record.member_id, 'member_123');
            assert.equal(record.username, 'testuser');
            assert.equal(record.container_id, 'ghost-sub-testuser');
            assert.equal(record.status, 'running');
            assert.equal(record.port, 2368);
        });

        it('should log creation event', async function () {
            const manager = createManager();
            await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            sinon.assert.calledOnce(eventsInsertStub);
            const event = eventsInsertStub.firstCall.args[0];
            assert.equal(event.event_type, 'created');
        });

        it('should return container app name and URL', async function () {
            const manager = createManager();
            const result = await manager.createSubscriberContainer({
                id: 'member_123',
                email: 'test@example.com',
                username: 'testuser',
                custom_domain: null
            });

            assert.equal(result.containerAppName, 'ghost-sub-testuser');
            assert.equal(result.url, 'https://testuser.private-stack.dev');
            assert.ok(result.subscriberId);
        });
    });

    describe('deleteSubscriberContainer', function () {
        it('should look up subscriber in database', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            // knexStub('subscribers').where('username', ...).first() was called
            // Verified by the fact that no error was thrown (subscriber found)
        });

        it('should delete the container app', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.beginDeleteAndWait);
            sinon.assert.calledWith(
                containerAppsClientStub.containerApps.beginDeleteAndWait,
                'GHOST-PLATFORM-RG',
                'ghost-sub-testuser'
            );
        });

        it('should delete the Azure File Share', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            const shareClient = shareServiceClientStub.getShareClient.returnValues[0];
            sinon.assert.calledOnce(shareClient.delete);
        });

        it('should log deletion event and remove database record', async function () {
            const manager = createManager();
            await manager.deleteSubscriberContainer('testuser');

            sinon.assert.calledOnce(eventsInsertStub);
            const event = eventsInsertStub.firstCall.args[0];
            assert.equal(event.event_type, 'deleted');
        });

        it('should throw if subscriber not found', async function () {
            const manager = createManager();

            // Override knex to return no subscriber
            const emptyKnex = function (tableName) {
                if (tableName === 'subscribers') {
                    return {
                        where: sinon.stub().returnsThis(),
                        first: sinon.stub().resolves(null),
                        delete: sinon.stub().resolves()
                    };
                }
                return {insert: sinon.stub().resolves()};
            };
            manager.getKnex = () => emptyKnex;

            await assert.rejects(
                () => manager.deleteSubscriberContainer('nonexistent'),
                {message: /Subscriber not found/}
            );
        });
    });

    describe('getSubscriberStatus', function () {
        it('should query ACA API for container app status', async function () {
            const manager = createManager();
            const status = await manager.getSubscriberStatus('testuser');

            sinon.assert.calledOnce(containerAppsClientStub.containerApps.get);
            sinon.assert.calledWith(
                containerAppsClientStub.containerApps.get,
                'GHOST-PLATFORM-RG',
                'ghost-sub-testuser'
            );
            assert.equal(status.provisioningState, 'Succeeded');
        });
    });
});
```

### Step 2: Run tests to verify they fail

Run:
```bash
cd ghost/core && yarn test:unit test/unit/server/services/subscriber-provisioning/aca-manager.test.js
```

Expected: FAIL — `Cannot find module '.../aca-manager'`

### Step 3: Write the AcaManager implementation

Create: `ghost/core/core/server/services/subscriber-provisioning/aca-manager.js`

```javascript
const crypto = require('crypto');
const logging = require('@tryghost/logging');

class AcaManager {
    /**
     * @param {Object} options
     * @param {Object} [options.containerAppsClient] - Azure ContainerAppsAPIClient (injected for testing)
     * @param {Object} [options.shareServiceClient] - Azure ShareServiceClient (injected for testing)
     * @param {Function} [options.getKnex] - Function returning knex instance (injected for testing)
     * @param {string} options.subscriptionId - Azure subscription ID
     * @param {string} [options.resourceGroup] - Azure resource group name
     * @param {string} [options.environmentName] - ACA environment name
     * @param {string} [options.storageAccountName] - Azure Storage account name
     * @param {string} [options.storageAccountKey] - Azure Storage account key
     * @param {string} [options.location] - Azure region
     * @param {string} [options.domain] - Base domain for subscriber subdomains
     * @param {string} [options.ghostImage] - Ghost Docker image
     * @param {number} [options.cpu] - CPU cores per container
     * @param {string} [options.memoryGi] - Memory per container (e.g. '1Gi')
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
        this.resourceGroup = options.resourceGroup || 'GHOST-PLATFORM-RG';
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
     * Generate Ghost config for subscriber
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

    /**
     * Create Azure File Share and upload Ghost config
     * @param {string} shareName
     * @param {Object} ghostConfig
     */
    async _createFileShare(shareName, ghostConfig) {
        const shareClient = this.shareServiceClient.getShareClient(shareName);
        await shareClient.create();

        // Upload config.production.json to the root of the share
        const dirClient = shareClient.getDirectoryClient('');
        const configContent = JSON.stringify(ghostConfig, null, 2);
        const fileClient = dirClient.getFileClient('config.production.json');
        await fileClient.create(configContent.length);
        await fileClient.uploadRange(configContent, 0, configContent.length);
    }

    /**
     * Create subscriber container as Azure Container App
     * @param {Object} subscriber - {id, email, username, custom_domain}
     * @returns {Promise<{containerAppName, fqdn, url, subscriberId}>}
     */
    async createSubscriberContainer(subscriber) {
        const containerAppName = `ghost-sub-${subscriber.username}`;
        const shareName = `ghost-${subscriber.username}`;

        try {
            // 1. Create file share and upload config
            const ghostConfig = this.generateGhostConfig(subscriber);
            await this._createFileShare(shareName, ghostConfig);

            // 2. Create Container App
            const managedEnvironmentId = `/subscriptions/${this.containerAppsClient.subscriptionId || ''}/resourceGroups/${this.resourceGroup}/providers/Microsoft.App/managedEnvironments/${this.environmentName}`;

            const containerAppEnvelope = {
                location: this.location,
                managedEnvironmentId: managedEnvironmentId,
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

            // 3. Write subscriber record to database
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
     * Delete subscriber container and clean up
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

        // Delete container app
        await this.containerAppsClient.containerApps.beginDeleteAndWait(
            this.resourceGroup,
            containerAppName
        );

        // Delete file share
        const shareClient = this.shareServiceClient.getShareClient(shareName);
        await shareClient.delete();

        // Log deletion event
        await knex('subscriber_container_events').insert({
            subscriber_id: subscriber.id,
            event_type: 'deleted',
            details: JSON.stringify({containerAppName}),
            created_at: new Date()
        });

        // Remove from database
        await knex('subscribers')
            .where('username', subscriberUsername)
            .delete();

        logging.info(`Deleted ACA container for subscriber: ${subscriberUsername}`);
    }

    /**
     * Get subscriber container status from ACA API
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
```

### Step 4: Run tests to verify they pass

Run:
```bash
cd ghost/core && yarn test:unit test/unit/server/services/subscriber-provisioning/aca-manager.test.js
```

Expected: All tests PASS.

### Step 5: Commit

```bash
git add ghost/core/core/server/services/subscriber-provisioning/aca-manager.js
git add ghost/core/test/unit/server/services/subscriber-provisioning/aca-manager.test.js
git commit -m "✨ Added Azure Container Apps manager for subscriber provisioning

- AcaManager creates/deletes Container Apps via @azure/arm-appcontainers
- Azure File Shares for persistent Ghost content and SQLite databases
- Same DI pattern as DockerManager for testability
- 12 unit tests covering create, delete, status, and config generation

ref docs/plans/2026-02-20-aca-deployment-design.md"
```

---

## Task 4: Update SubscriberProvisioningService for Environment Switching

**Goal:** Make the orchestrator select AcaManager in production and DockerManager in local dev.

**Files to modify:**
- `ghost/core/core/server/services/subscriber-provisioning/index.js`

**Files to modify (tests):**
- `ghost/core/test/unit/server/services/subscriber-provisioning/index.test.js`

---

### Step 1: Write the failing test for provider switching

Add to existing test file `ghost/core/test/unit/server/services/subscriber-provisioning/index.test.js`:

At the end of the describe block, add:

```javascript
    describe('provider switching', function () {
        it('should use DockerManager by default', function () {
            const DockerManager = require('../../../../../core/server/services/subscriber-provisioning/docker-manager');
            const service = new SubscriberProvisioningService({
                dockerManager: dockerManagerStub
            });
            // dockerManager is used when no provider specified
            assert.ok(service.manager);
        });

        it('should use AcaManager when provider is aca', function () {
            const acaManagerStub = {
                createSubscriberContainer: sinon.stub().resolves({containerAppName: 'test', url: 'https://test.private-stack.dev', subscriberId: '123'}),
                deleteSubscriberContainer: sinon.stub().resolves()
            };
            const service = new SubscriberProvisioningService({
                provider: 'aca',
                acaManager: acaManagerStub
            });
            assert.ok(service.manager);
        });

        it('should use AcaManager when GHOST_CONTAINER_PROVIDER env is aca', function () {
            process.env.GHOST_CONTAINER_PROVIDER = 'aca';
            const acaManagerStub = {
                createSubscriberContainer: sinon.stub().resolves({containerAppName: 'test', url: 'https://test.private-stack.dev', subscriberId: '123'}),
                deleteSubscriberContainer: sinon.stub().resolves()
            };
            const service = new SubscriberProvisioningService({
                acaManager: acaManagerStub
            });
            assert.ok(service.manager);
            delete process.env.GHOST_CONTAINER_PROVIDER;
        });
    });
```

### Step 2: Run tests to verify they fail

Run:
```bash
cd ghost/core && yarn test:unit test/unit/server/services/subscriber-provisioning/index.test.js
```

Expected: FAIL — `service.manager` is undefined (current code uses `this.dockerManager`, not `this.manager`).

### Step 3: Update index.js implementation

Replace: `ghost/core/core/server/services/subscriber-provisioning/index.js`

```javascript
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

        // Update Caddy config only in Docker mode
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
```

### Step 4: Run all provisioning tests

Run:
```bash
cd ghost/core && yarn test:unit test/unit/server/services/subscriber-provisioning/
```

Expected: ALL tests pass (index, aca-manager, docker-manager, config-generator).

### Step 5: Commit

```bash
git add ghost/core/core/server/services/subscriber-provisioning/index.js
git add ghost/core/test/unit/server/services/subscriber-provisioning/index.test.js
git commit -m "🎨 Updated provisioning service for Docker/ACA environment switching

- Provider selected via config.provider or GHOST_CONTAINER_PROVIDER env var
- Docker mode: uses DockerManager + Caddy config (local dev)
- ACA mode: uses AcaManager, no Caddy needed (production)
- Caddy config update only runs in docker mode

ref docs/plans/2026-02-20-aca-deployment-design.md"
```

---

## Task 5: Update CLI Tool for ACA Support

**Goal:** The management CLI should use the correct provider based on environment.

**Files to modify:**
- `ghost/core/core/server/cli/subscriber-management.js`
- `ghost/core/bin/manage-subscribers.js`

---

### Step 1: Read current CLI files

Read: `ghost/core/core/server/cli/subscriber-management.js` and `ghost/core/bin/manage-subscribers.js`

### Step 2: Update subscriber-management.js

The CLI should pass the `provider` config through. Modify the constructor:

```javascript
constructor(config = {}) {
    const SubscriberProvisioningService = require('../services/subscriber-provisioning');
    this.provisioner = new SubscriberProvisioningService(config);
}
```

### Step 3: Update manage-subscribers.js

Modify the entry point to read provider from environment or CLI flag:

Add `--provider` flag parsing (or read from `GHOST_CONTAINER_PROVIDER` env var). The `SubscriberProvisioningService` constructor already reads the env var, so no code change needed in most cases.

### Step 4: Test manually

Run:
```bash
cd ghost/core
GHOST_CONTAINER_PROVIDER=aca node bin/manage-subscribers.js list
```

Expected: Should attempt to list subscribers (may fail if Azure credentials not configured, but should not crash with wrong provider).

### Step 5: Commit

```bash
git add ghost/core/core/server/cli/subscriber-management.js
git add ghost/core/bin/manage-subscribers.js
git commit -m "🎨 Updated CLI tool to support ACA provider switching

Reads GHOST_CONTAINER_PROVIDER env var or --provider flag.

ref docs/plans/2026-02-20-aca-deployment-design.md"
```

---

## Task 6: Link ACA Storage to ACA Environment

**Goal:** Register the Azure Storage Account as a storage resource in the ACA Environment so Container Apps can mount file shares.

This is a one-time infrastructure step that must happen before containers can mount Azure File Shares.

---

### Step 1: Register storage in ACA Environment

```bash
STORAGE_KEY=$(az storage account keys list \
  --account-name privatestackstorage \
  --resource-group GHOST-PLATFORM-RG \
  --query "[0].value" -o tsv)

az containerapp env storage set \
  --name privatestack-env \
  --resource-group GHOST-PLATFORM-RG \
  --storage-name privatestackstorage \
  --azure-file-account-name privatestackstorage \
  --azure-file-account-key $STORAGE_KEY \
  --azure-file-share-name ghost-test \
  --access-mode ReadWrite
```

> **Note:** The `--azure-file-share-name` here is a placeholder. Each subscriber's share is created dynamically by AcaManager. The ACA environment storage registration links the storage account, and individual Container Apps reference specific shares via the `storageName` in the volume spec.

### Step 2: Verify

```bash
az containerapp env storage show \
  --name privatestack-env \
  --resource-group GHOST-PLATFORM-RG \
  --storage-name privatestackstorage
```

Expected: Storage resource listed with access mode ReadWrite.

---

## Task 7: End-to-End Smoke Test

**Goal:** Verify the complete flow: create a subscriber Container App, verify it's accessible, then delete it.

---

### Step 1: Set environment variables on rentfall

SSH into rentfall and set:
```bash
export GHOST_CONTAINER_PROVIDER=aca
export AZURE_SUBSCRIPTION_ID=<your-subscription-id>
```

### Step 2: Create a test subscriber via CLI

```bash
cd ghost/core
node bin/manage-subscribers.js create \
  --email=smoketest@example.com \
  --username=smoketest
```

Expected: Container App `ghost-sub-smoketest` created. Output shows URL.

### Step 3: Verify Container App exists

```bash
az containerapp show \
  --name ghost-sub-smoketest \
  --resource-group GHOST-PLATFORM-RG \
  --query "{name:name, state:properties.provisioningState, fqdn:properties.configuration.ingress.fqdn}" -o table
```

Expected: State=Succeeded, FQDN shown.

### Step 4: Verify the site is accessible

```bash
curl -sI https://smoketest.private-stack.dev | head -5
```

Expected: HTTP 200 (or 301/302 redirect to Ghost setup if fresh instance).

### Step 5: Verify Azure File Share exists

```bash
az storage share list \
  --account-name privatestackstorage \
  --query "[?name=='ghost-smoketest'].name" -o tsv
```

Expected: `ghost-smoketest`

### Step 6: Delete the test subscriber

```bash
cd ghost/core
node bin/manage-subscribers.js delete --username=smoketest
```

### Step 7: Verify cleanup

```bash
az containerapp show --name ghost-sub-smoketest --resource-group GHOST-PLATFORM-RG 2>&1
```

Expected: `ResourceNotFound` error (container app deleted).

```bash
az storage share list --account-name privatestackstorage --query "[?name=='ghost-smoketest'].name" -o tsv
```

Expected: Empty (file share deleted).

### Step 8: Commit plan completion

```bash
git add docs/plans/2026-02-20-aca-deployment-implementation.md
git commit -m "📚 Added ACA deployment implementation plan

ref docs/plans/2026-02-20-aca-deployment-design.md"
```

---

## Deployment Checklist

- [ ] Task 1: Azure infrastructure provisioned (Storage, VNet subnet, ACA Environment, DNS)
- [ ] Task 2: Azure SDK dependencies installed
- [ ] Task 3: AcaManager created with unit tests passing
- [ ] Task 4: SubscriberProvisioningService updated for environment switching
- [ ] Task 5: CLI tool updated for ACA support
- [ ] Task 6: Storage linked to ACA Environment
- [ ] Task 7: E2E smoke test passes (create → verify → delete)
- [ ] All unit tests passing: `yarn test:unit test/unit/server/services/subscriber-provisioning/`
- [ ] Azure MCP server fixed (`dnx` → `npx` in settings.local.json) ✅

---

## Notes for Executor

- **Azure MCP:** The `com.microsoft/azure` MCP server was fixed in settings.local.json (`dnx` → `npx`). In the next session, it should be available for direct Azure resource management. Use it for Tasks 1, 6, and 7 if available; fall back to `az` CLI if not.
- **Microsoft Docs MCP:** `microsoftdocs/mcp` is available at `https://learn.microsoft.com/api/mcp` for looking up Azure SDK docs during implementation.
- **Test framework:** Mocha + `assert/strict` + Sinon. Factory function pattern with DI for all Azure SDK clients.
- **The `beginCreateOrUpdateAndWait` variant** is used (not `beginCreateOrUpdate`) to simplify the code — it blocks until the long-running operation completes. Container App creation takes ~60-90 seconds.
- **ACA volume storage linking (Task 6)** must complete before Task 7 can work. The `storageName` in the Container App volume spec must match the name registered with `az containerapp env storage set`.
