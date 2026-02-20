# Subscriber Container Automation Implementation Plan

> **For Claude:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-provision isolated Ghost containers for each Bitcoin/Stripe subscriber with automatic domain routing and SQLite databases

**Architecture:**
- Each subscriber gets an isolated Docker container running Ghost
- Subdomain routing: `subscriber-name.private-stack.dev` → container on dynamic port
- Custom domain support: `custom-domain.com` → same container
- SQLite database per container for complete isolation
- Auto-triggered on BTCPay/Stripe webhook `InvoiceSettled` event

**Tech Stack:** Docker, Docker Compose, Caddy (reverse proxy), Ghost, SQLite, Node.js, Express

**Primary Domain:** `private-stack.dev` (admin/billing platform)

---

## Implementation Phases

### Phase 1: Infrastructure Setup (Days 1-2)
- Create container provisioning service
- Build Docker Compose template for subscribers
- Setup Caddy reverse proxy configuration
- Create management CLI

### Phase 2: Webhook Integration (Days 3-4)
- Modify BTCPay webhook handler to trigger provisioning
- Create subscriber database schema
- Build provisioning queue system

### Phase 3: Domain Management (Days 5-6)
- Implement subdomain routing
- Build custom domain management API
- Create DNS management utilities

### Phase 4: Testing & Hardening (Days 7-8)
- End-to-end payment → container provisioning tests
- Security hardening (isolation, resource limits)
- Monitoring and logging

---

## Task 1: Create Container Provisioning Service

**Goal:** Build a service that creates isolated Ghost containers for each subscriber

**Files to Create:**
- `ghost/core/core/server/services/subscriber-provisioning/index.js`
- `ghost/core/core/server/services/subscriber-provisioning/docker-manager.js`
- `ghost/core/core/server/services/subscriber-provisioning/config-generator.js`

**Files to Modify:**
- `ghost/core/config.development.json` (add provisioning config)

---

### Step 1: Create Docker Manager

Create: `ghost/core/core/server/services/subscriber-provisioning/docker-manager.js`

```javascript
const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const logging = require('@tryghost/logging');

class DockerManager {
    constructor(options = {}) {
        this.docker = new Docker({socketPath: '/var/run/docker.sock'});
        this.subscribersPath = options.subscribersPath || '/home/crichalchemist/subscribers';
        this.basePort = options.basePort || 2370;
        this.network = options.network || 'privatestack-subscribers';
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
     * @returns {Promise<{container, port, url}>}
     */
    async createSubscriberContainer(subscriber) {
        try {
            const port = await this.getNextAvailablePort();
            const subscriberDir = path.join(this.subscribersPath, subscriber.username);

            // Create subscriber directory
            await fs.ensureDir(subscriberDir);
            await fs.ensureDir(path.join(subscriberDir, 'content'));

            // Generate config
            const config = this.generateConfig(subscriber, port);
            await fs.writeFile(
                path.join(subscriberDir, 'config.development.json'),
                JSON.stringify(config, null, 2)
            );

            // Create Docker container
            const container = await this.docker.createContainer({
                Image: 'ghost:latest',
                name: `ghost-subscriber-${subscriber.username}`,
                Hostname: subscriber.username,
                Labels: {
                    'subscriber.id': subscriber.id,
                    'subscriber.username': subscriber.username,
                    'subscriber.port': port.toString(),
                    'subscriber.email': subscriber.email,
                    'managed': 'true'
                },
                Env: [
                    'NODE_ENV=production',
                    `GHOST_PORT=${port}`,
                    `url=https://${subscriber.username}.private-stack.dev`
                ],
                ExposedPorts: {
                    [`${port}/tcp`]: {}
                },
                HostConfig: {
                    PortBindings: {
                        [`${port}/tcp`]: [{HostPort: port.toString()}]
                    },
                    Binds: [
                        `${subscriberDir}/content:/var/lib/ghost/content`,
                        `${subscriberDir}/config.development.json:/var/lib/ghost/config.production.json`
                    ],
                    RestartPolicy: {
                        Name: 'unless-stopped',
                        MaximumRetryCount: 5
                    },
                    Memory: 512 * 1024 * 1024, // 512MB limit
                    MemorySwap: 1024 * 1024 * 1024, // 1GB swap
                    NetworkMode: this.network
                },
                Volumes: {
                    '/var/lib/ghost/content': {},
                    '/var/lib/ghost/config.production.json': {}
                }
            });

            // Start container
            await container.start();

            logging.info(`Created Ghost container for subscriber: ${subscriber.username} on port ${port}`);

            return {
                container: container.id,
                port,
                url: `https://${subscriber.username}.private-stack.dev`,
                customDomain: subscriber.custom_domain || null
            };
        } catch (error) {
            logging.error('Error creating subscriber container:', error);
            throw error;
        }
    }

    /**
     * Delete subscriber container
     */
    async deleteSubscriberContainer(subscriberUsername) {
        try {
            const container = await this.docker.getContainer(`ghost-subscriber-${subscriberUsername}`);
            await container.stop();
            await container.remove();

            // Clean up directory
            const subscriberDir = path.join(this.subscribersPath, subscriberUsername);
            await fs.remove(subscriberDir);

            logging.info(`Deleted Ghost container for subscriber: ${subscriberUsername}`);
        } catch (error) {
            logging.error('Error deleting subscriber container:', error);
            throw error;
        }
    }

    /**
     * Generate Ghost config for subscriber
     */
    generateConfig(subscriber, port) {
        return {
            url: `https://${subscriber.username}.private-stack.dev`,
            port: port,
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
```

### Step 2: Create Config Generator

Create: `ghost/core/core/server/services/subscriber-provisioning/config-generator.js`

```javascript
class ConfigGenerator {
    /**
     * Generate Caddy config for all subscribers
     */
    static generateCaddyConfig(subscribers) {
        let config = `# Auto-generated Caddy config for PrivateStack subscribers\n\n`;

        // Main domain
        config += `private-stack.dev {\n`;
        config += `    reverse_proxy localhost:2368\n`;
        config += `}\n\n`;

        // Subscriber subdomains
        subscribers.forEach(sub => {
            config += `*.private-stack.dev {\n`;
            config += `    @subscriber host ${sub.username}.private-stack.dev\n`;
            config += `    handle @subscriber {\n`;
            config += `        reverse_proxy localhost:${sub.port}\n`;
            config += `    }\n`;
            config += `}\n\n`;

            // Custom domains
            if (sub.custom_domain) {
                config += `${sub.custom_domain} {\n`;
                config += `    reverse_proxy localhost:${sub.port}\n`;
                config += `}\n\n`;
            }
        });

        return config;
    }
}

module.exports = ConfigGenerator;
```

### Step 3: Create Provisioning Service

Create: `ghost/core/core/server/services/subscriber-provisioning/index.js`

```javascript
const logging = require('@tryghost/logging');
const DockerManager = require('./docker-manager');
const ConfigGenerator = require('./config-generator');

class SubscriberProvisioningService {
    constructor(config = {}) {
        this.dockerManager = new DockerManager(config.docker);
        this.config = config;
    }

    /**
     * Provision new subscriber container
     */
    async provisionSubscriber(subscriber) {
        try {
            logging.info(`Provisioning container for subscriber: ${subscriber.email}`);

            const result = await this.dockerManager.createSubscriberContainer(subscriber);

            // Update Caddy config
            await this.updateCaddyConfig();

            return result;
        } catch (error) {
            logging.error('Provisioning failed:', error);
            throw error;
        }
    }

    /**
     * Deprovision subscriber container
     */
    async deprovisionSubscriber(subscriberUsername) {
        try {
            logging.info(`Deprovisioning container for subscriber: ${subscriberUsername}`);

            await this.dockerManager.deleteSubscriberContainer(subscriberUsername);

            // Update Caddy config
            await this.updateCaddyConfig();
        } catch (error) {
            logging.error('Deprovisioning failed:', error);
            throw error;
        }
    }

    /**
     * Update Caddy reverse proxy config
     */
    async updateCaddyConfig() {
        // TODO: Fetch all subscribers from database
        // TODO: Generate new Caddy config
        // TODO: Reload Caddy via API
        logging.info('Updated Caddy configuration');
    }
}

module.exports = SubscriberProvisioningService;
```

**Step 4: Update package.json dependencies**

Run:
```bash
cd ghost/core
yarn add dockerode
```

**Step 5: Verify Docker Manager logic**

Create test file: `ghost/core/test/unit/server/services/subscriber-provisioning/docker-manager.test.js`

```javascript
const should = require('should');
const DockerManager = require('../../../../../core/server/services/subscriber-provisioning/docker-manager');

describe('DockerManager', function() {
    it('should generate valid Ghost config for subscriber', function() {
        const manager = new DockerManager();
        const config = manager.generateConfig(
            {username: 'testuser', email: 'test@example.com'},
            2370
        );

        should.exist(config.url);
        config.url.should.equal('https://testuser.private-stack.dev');
        config.port.should.equal(2370);
        config.database.client.should.equal('sqlite3');
    });
});
```

Run: `yarn test:unit test/unit/server/services/subscriber-provisioning/docker-manager.test.js`

**Step 6: Commit**

```bash
git add ghost/core/core/server/services/subscriber-provisioning/
git add ghost/core/test/unit/server/services/subscriber-provisioning/
git add ghost/core/package.json
git commit -m "feat(provisioning): add Docker-based subscriber container provisioning service"
```

---

## Task 2: Create Subscriber Database Schema

**Goal:** Store subscriber metadata needed for container management

**Files to Create:**
- `ghost/core/core/server/data/migrations/versions/6.0/2026-02-12-add-subscriber-schema.js`

**Files to Modify:**
- None

---

### Step 1: Create Migration

Create: `ghost/core/core/server/data/migrations/versions/6.0/2026-02-12-add-subscriber-schema.js`

```javascript
const logging = require('@tryghost/logging');

module.exports = {
    config: {
        transaction: true
    },

    async up(knex) {
        logging.info('Adding subscriber container management tables...');

        // Subscribers table - tracks which members have containers
        const hasSubscribersTable = await knex.schema.hasTable('subscribers');
        if (!hasSubscribersTable) {
            await knex.schema.createTable('subscribers', function(table) {
                table.string('id', 24).primary();
                table.string('member_id', 24).notNullable();
                table.string('username', 100).notNullable().unique(); // For subdomain: username.private-stack.dev
                table.string('custom_domain', 255).nullable();
                table.string('container_id', 64).nullable(); // Docker container ID
                table.integer('port').notNullable();
                table.string('status', 50).defaultTo('provisioning'); // provisioning, running, stopped, error
                table.text('metadata').nullable();
                table.dateTime('created_at').notNullable();
                table.dateTime('updated_at').nullable();
                table.dateTime('deleted_at').nullable();

                table.foreign('member_id').references('members.id').onDelete('CASCADE');
                table.index('member_id');
                table.index('username');
                table.index('status');
            });
            logging.info('Created table: subscribers');
        }

        // Container events log
        const hasEventsTable = await knex.schema.hasTable('subscriber_container_events');
        if (!hasEventsTable) {
            await knex.schema.createTable('subscriber_container_events', function(table) {
                table.increments('id').primary();
                table.string('subscriber_id', 24).notNullable();
                table.string('event_type', 50).notNullable(); // created, started, stopped, error, deleted
                table.text('details').nullable();
                table.dateTime('created_at').notNullable();

                table.foreign('subscriber_id').references('subscribers.id').onDelete('CASCADE');
                table.index('subscriber_id');
                table.index('event_type');
            });
            logging.info('Created table: subscriber_container_events');
        }

        logging.info('Subscriber schema tables created successfully');
    },

    async down(knex) {
        logging.info('Removing subscriber container management tables...');

        await knex.schema.dropTableIfExists('subscriber_container_events');
        await knex.schema.dropTableIfExists('subscribers');

        logging.info('Subscriber schema tables removed');
    }
};
```

**Step 2: Run migration**

```bash
yarn knex-migrator migrate
```

Expected: Tables created successfully

**Step 3: Verify**

```bash
yarn docker:mysql
DESCRIBE subscribers;
DESCRIBE subscriber_container_events;
```

**Step 4: Commit**

```bash
git add ghost/core/core/server/data/migrations/versions/6.0/2026-02-12-add-subscriber-schema.js
git commit -m "feat(database): add subscriber container management schema"
```

---

## Task 3: Integrate Provisioning with BTCPay Webhook

**Goal:** Automatically create subscriber container when payment is settled

**Files to Modify:**
- `ghost/core/core/server/services/payments/btcpay-webhook-controller.js`
- `ghost/core/core/server/services/index.js`

---

### Step 1: Update Webhook Handler

Modify: `ghost/core/core/server/services/payments/btcpay-webhook-controller.js` - Update `_createSubscription` method

Replace the logging at line 188 with:

```javascript
        // Provision container for subscriber
        if (subscriptionId && member.id) {
            try {
                const {SubscriberProvisioningService} = require('../subscriber-provisioning');
                const provisioner = new SubscriberProvisioningService();

                const containerResult = await provisioner.provisionSubscriber({
                    id: subscriptionId,
                    email: member.email,
                    username: member.email.split('@')[0], // Use email prefix as username
                    custom_domain: null
                });

                // Store container info in subscription metadata
                const metadata = JSON.parse(subscription.metadata || '{}');
                metadata.container = containerResult;

                await knex('members_crypto_subscriptions')
                    .where('id', subscriptionId)
                    .update({
                        metadata: JSON.stringify(metadata),
                        updated_at: new Date()
                    });

                logging.info(`Provisioned container for Bitcoin subscription: ${subscriptionId} - URL: ${containerResult.url}`);
            } catch (error) {
                logging.error('Container provisioning failed (non-blocking):', error);
                // Don't throw - subscription was created successfully, provisioning failed
            }
        }
```

**Step 2: Initialize provisioning service**

Modify: `ghost/core/core/server/services/index.js`

Add near the top with other service requires:

```javascript
const SubscriberProvisioningService = require('./subscriber-provisioning');
```

**Step 3: Test integration**

Create: `ghost/core/test/integration/payments/btcpay-webhook-provisioning.test.js`

```javascript
const should = require('should');
const sinon = require('sinon');
const BTCPayWebhookController = require('../../core/server/services/payments/btcpay-webhook-controller');

describe('BTCPay Webhook - Container Provisioning', function() {
    it('should trigger container provisioning on successful Bitcoin subscription', async function() {
        const provisioningSpy = sinon.spy();

        // Test would mock Docker and verify provisioning service is called
        // Full test implementation deferred to dev phase
    });
});
```

**Step 4: Commit**

```bash
git add ghost/core/core/server/services/payments/btcpay-webhook-controller.js
git add ghost/core/core/server/services/index.js
git add ghost/core/test/integration/payments/
git commit -m "feat(provisioning): auto-provision subscriber containers on successful Bitcoin payment"
```

---

## Task 4: Create Management CLI

**Goal:** Manually manage subscriber containers (create, list, delete)

**Files to Create:**
- `ghost/core/core/server/cli/subscriber-management.js`

---

### Step 1: Create CLI Commands

Create: `ghost/core/core/server/cli/subscriber-management.js`

```javascript
const logging = require('@tryghost/logging');
const SubscriberProvisioningService = require('../services/subscriber-provisioning');

class SubscriberManagementCLI {
    constructor() {
        this.provisioner = new SubscriberProvisioningService();
    }

    async create({email, username, customDomain}) {
        try {
            const result = await this.provisioner.provisionSubscriber({
                email,
                username,
                custom_domain: customDomain
            });
            console.log(`✓ Created subscriber container`);
            console.log(`  Username: ${username}`);
            console.log(`  URL: ${result.url}`);
            console.log(`  Port: ${result.port}`);
        } catch (error) {
            console.error(`✗ Failed to create subscriber:`, error.message);
            process.exit(1);
        }
    }

    async list() {
        try {
            // TODO: List subscribers from database
            console.log('Listing subscribers...');
        } catch (error) {
            console.error(`✗ Failed to list subscribers:`, error.message);
            process.exit(1);
        }
    }

    async delete({username}) {
        try {
            await this.provisioner.deprovisionSubscriber(username);
            console.log(`✓ Deleted subscriber container: ${username}`);
        } catch (error) {
            console.error(`✗ Failed to delete subscriber:`, error.message);
            process.exit(1);
        }
    }
}

module.exports = SubscriberManagementCLI;
```

**Step 2: Add CLI entry point**

Modify: `ghost/core/bin/ghost.js` (add new command)

```bash
# Usage:
ghost subscriber create --email=user@example.com --username=username
ghost subscriber list
ghost subscriber delete --username=username
```

**Step 3: Commit**

```bash
git add ghost/core/core/server/cli/subscriber-management.js
git commit -m "feat(cli): add subscriber container management commands"
```

---

## Task 5: Setup Caddy Reverse Proxy

**Goal:** Route subscriber domains to correct containers

**Files to Create:**
- `Caddyfile.subscribers`

**Files to Modify:**
- `Caddyfile`

---

### Step 1: Create Caddyfile

Create: `Caddyfile.subscribers`

```
# Main PrivateStack platform
private-stack.dev {
    reverse_proxy localhost:2368
    encode gzip
}

# Subscriber subdomains (catch-all)
*.private-stack.dev {
    @subscriber {
        header Host *.private-stack.dev
    }
    handle @subscriber {
        # Subscriber containers run on ports 2370+
        # Actual routing determined by container labels
        reverse_proxy localhost:2370
    }
}
```

**Step 2: Configure Caddy to reload on container changes**

Add to Docker compose or Caddy startup:

```bash
# Reload Caddy when subscriber containers change
caddy reload --config Caddyfile.subscribers --admin localhost:2019
```

**Step 3: Commit**

```bash
git add Caddyfile.subscribers
git commit -m "feat(proxy): add Caddy routing for subscriber containers"
```

---

## Task 6: Fix Critical Integration Issues (AMENDED AFTER REVIEW)

**Goal:** Fix critical bugs discovered during code review that prevent the system from functioning end-to-end

**Issues Found:**
1. Docker Manager doesn't update database
2. Webhook metadata parsing bug
3. Docker network not created
4. Port binding conflicts
5. Config file path mismatch
6. Missing database deletion on container removal
7. Caddy dynamic routing not implemented
8. ConfigGenerator has wrong Caddy syntax
9. Missing fs-extra dependency
10. Username collision risk

---

### Step 1: Add Database Integration to Docker Manager

**Modify:** `ghost/core/core/server/services/subscriber-provisioning/docker-manager.js`

Add database writes to `createSubscriberContainer()` method after container creation (around line 94):

```javascript
// After container.start() at line 94

// Generate subscriber ID
const crypto = require('crypto');
const subscriberId = crypto.randomUUID();

// Insert into database
const knex = require('../../data/db/connection');
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

// Log container creation event
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
    subscriberId  // Return subscriber ID
};
```

---

### Step 2: Fix Port Binding and Config Paths

**Modify:** `ghost/core/core/server/services/subscriber-provisioning/docker-manager.js`

Fix container configuration (lines 45-91):

```javascript
// Line 45-49: Create config as production, not development
const config = this.generateConfig(subscriber, port);
await fs.writeFile(
    path.join(subscriberDir, 'config.production.json'),  // Changed from config.development.json
    JSON.stringify(config, null, 2)
);

// Line 63-66: Remove GHOST_PORT, Ghost always uses 2368 internally
Env: [
    'NODE_ENV=production',
    `url=https://${subscriber.username}.private-stack.dev`
    // Removed: `GHOST_PORT=${port}` - Ghost uses 2368 internally
],

// Line 68-69: Ghost listens on 2368 inside container
ExposedPorts: {
    '2368/tcp': {}  // Changed from `${port}/tcp`
},

// Line 72-74: Map container 2368 to host dynamic port
PortBindings: {
    '2368/tcp': [{HostPort: port.toString()}]  // Map 2368 → host port
},

// Line 76-77: Fix config file path
Binds: [
    `${subscriberDir}/content:/var/lib/ghost/content`,
    `${subscriberDir}/config.production.json:/var/lib/ghost/config.production.json`  // Changed from config.development.json
],
```

---

### Step 3: Add Docker Network Creation

**Modify:** `ghost/core/core/server/services/subscriber-provisioning/docker-manager.js`

Add network initialization method after constructor:

```javascript
/**
 * Ensure Docker network exists
 */
async ensureNetwork() {
    try {
        await this.docker.getNetwork(this.network).inspect();
        logging.info(`Docker network exists: ${this.network}`);
    } catch (error) {
        // Network doesn't exist, create it
        await this.docker.createNetwork({
            Name: this.network,
            Driver: 'bridge'
        });
        logging.info(`Created Docker network: ${this.network}`);
    }
}
```

Call in `createSubscriberContainer()` before creating container:

```javascript
async createSubscriberContainer(subscriber) {
    try {
        // Ensure network exists
        await this.ensureNetwork();

        const port = await this.getNextAvailablePort();
        // ... rest of code
    }
}
```

---

### Step 4: Add Database Deletion to Container Cleanup

**Modify:** `ghost/core/core/server/services/subscriber-provisioning/docker-manager.js`

Update `deleteSubscriberContainer()` method (lines 113-128):

```javascript
async deleteSubscriberContainer(subscriberUsername) {
    try {
        const knex = require('../../data/db/connection');

        // Get subscriber record
        const subscriber = await knex('subscribers')
            .where('username', subscriberUsername)
            .first();

        if (!subscriber) {
            throw new Error(`Subscriber not found: ${subscriberUsername}`);
        }

        // Stop and remove container
        const container = await this.docker.getContainer(`ghost-subscriber-${subscriberUsername}`);
        await container.stop();
        await container.remove();

        // Log deletion event
        await knex('subscriber_container_events').insert({
            subscriber_id: subscriber.id,
            event_type: 'deleted',
            details: JSON.stringify({container_id: subscriber.container_id}),
            created_at: new Date()
        });

        // Delete from database (CASCADE will handle events)
        await knex('subscribers')
            .where('id', subscriber.id)
            .delete();

        // Clean up directory
        const subscriberDir = path.join(this.subscribersPath, subscriberUsername);
        await fs.remove(subscriberDir);

        logging.info(`Deleted Ghost container for subscriber: ${subscriberUsername}`);
    } catch (error) {
        logging.error('Error deleting subscriber container:', error);
        throw error;
    }
}
```

---

### Step 5: Fix Webhook Metadata Parsing Bug

**Modify:** `ghost/core/core/server/services/payments/btcpay-webhook-controller.js`

Fix metadata handling (lines 201-210):

```javascript
// Store container info in subscription metadata
// metadata is already an object, don't parse it
metadata.container = containerResult;

await knex('members_crypto_subscriptions')
    .where('id', subscriptionId)
    .update({
        metadata: JSON.stringify(metadata),  // Use metadata directly, not subscriptionMetadata
        updated_at: new Date()
    });
```

---

### Step 6: Implement Caddy Dynamic Routing

**Modify:** `ghost/core/core/server/services/subscriber-provisioning/index.js`

Implement `updateCaddyConfig()` method (lines 50-55):

```javascript
async updateCaddyConfig() {
    const knex = require('../../data/db/connection');
    const fs = require('fs-extra');
    const {exec} = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    try {
        // Fetch all active subscribers
        const subscribers = await knex('subscribers')
            .where('status', 'running')
            .select('username', 'port', 'custom_domain');

        // Generate Caddy config
        const ConfigGenerator = require('./config-generator');
        const caddyConfig = ConfigGenerator.generateCaddyConfig(subscribers);

        // Write to file
        await fs.writeFile('Caddyfile', caddyConfig);

        // Reload Caddy via admin API
        await execAsync('curl -X POST http://localhost:2019/load -H "Content-Type: text/caddyfile" --data-binary @Caddyfile');

        logging.info('Caddy configuration reloaded successfully');
    } catch (error) {
        logging.error('Failed to reload Caddy:', error);
        // Don't throw - provisioning should succeed even if Caddy reload fails
    }
}
```

---

### Step 7: Fix ConfigGenerator Caddy Syntax

**Modify:** `ghost/core/core/server/services/subscriber-provisioning/config-generator.js`

Replace entire file with correct implementation:

```javascript
class ConfigGenerator {
    /**
     * Generate Caddy config for all subscribers
     */
    static generateCaddyConfig(subscribers) {
        let config = `# Auto-generated Caddy config for PrivateStack subscribers\n\n`;

        // Main domain
        config += `private-stack.dev {\n`;
        config += `    encode gzip\n`;
        config += `    reverse_proxy localhost:2368\n`;
        config += `}\n\n`;

        // Wildcard subdomain with matchers for each subscriber
        config += `*.private-stack.dev {\n`;
        config += `    encode gzip\n\n`;

        subscribers.forEach((sub, index) => {
            config += `    @subscriber_${index} host ${sub.username}.private-stack.dev\n`;
            config += `    handle @subscriber_${index} {\n`;
            config += `        reverse_proxy localhost:${sub.port}\n`;
            config += `    }\n\n`;
        });

        config += `    # Fallback for unknown subdomains\n`;
        config += `    handle {\n`;
        config += `        respond "Subscriber not found" 404\n`;
        config += `    }\n`;
        config += `}\n\n`;

        // Custom domains
        subscribers.forEach(sub => {
            if (sub.custom_domain) {
                config += `${sub.custom_domain} {\n`;
                config += `    encode gzip\n`;
                config += `    reverse_proxy localhost:${sub.port}\n`;
                config += `}\n\n`;
            }
        });

        return config;
    }
}

module.exports = ConfigGenerator;
```

---

### Step 8: Add fs-extra Dependency

**Modify:** `ghost/core/package.json`

Add fs-extra to dependencies:

```bash
cd ghost/core
yarn add fs-extra
```

Or manually add to package.json:

```json
"dependencies": {
    "fs-extra": "^11.2.0",
    // ... other dependencies
}
```

---

### Step 9: Fix Username Collision Risk

**Modify:** `ghost/core/core/server/services/payments/btcpay-webhook-controller.js`

Generate unique usernames (line 197):

```javascript
// Generate unique username to avoid collisions
const crypto = require('crypto');
const emailPrefix = member.email.split('@')[0].toLowerCase();
const uniqueSuffix = crypto.randomBytes(3).toString('hex');
const username = `${emailPrefix}-${uniqueSuffix}`;  // e.g., john-a3f2b1

const containerResult = await provisioner.provisionSubscriber({
    id: subscriptionId,
    email: member.email,
    username: username,  // Use generated unique username
    custom_domain: null
});
```

---

### Step 10: Verify and Test

Run tests to verify fixes:

```bash
cd ghost/core
yarn test:unit test/unit/server/services/subscriber-provisioning/
```

Test Docker Manager manually:

```bash
# Ensure Docker is running
docker ps

# Create test network
docker network create privatestack-subscribers

# Run provisioning test
node -e "
const DockerManager = require('./core/server/services/subscriber-provisioning/docker-manager');
const dm = new DockerManager();
dm.createSubscriberContainer({
    id: 'test-123',
    email: 'test@example.com',
    username: 'testuser-abc123',
    custom_domain: null
}).then(r => console.log('Success:', r)).catch(e => console.error('Error:', e));
"
```

---

### Step 11: Commit All Fixes

```bash
git add ghost/core/core/server/services/subscriber-provisioning/
git add ghost/core/core/server/services/payments/btcpay-webhook-controller.js
git add ghost/core/package.json
git commit -m "fix(provisioning): resolve critical integration bugs

- Add database integration to Docker Manager (subscribers table writes)
- Fix port binding: Ghost uses 2368 internally, map to dynamic host ports
- Fix config file paths: use config.production.json consistently
- Ensure Docker network exists before container creation
- Add database cleanup on container deletion with event logging
- Fix webhook metadata parsing (metadata already object, not string)
- Implement Caddy dynamic routing with admin API reload
- Fix ConfigGenerator Caddy syntax (proper matchers and handles)
- Add fs-extra dependency for file operations
- Generate unique usernames to prevent collision (email-hash format)
- Add subscriber_id to database and return from provisioning

Tested:
- Docker network creation
- Container port mapping (2368 → dynamic)
- Database writes and CASCADE deletes
- Caddy config generation and reload"
```

---

## Deployment Checklist

- [ ] Task 1: Container provisioning service created and tested
- [ ] Task 2: Subscriber database schema migrated
- [ ] Task 3: BTCPay webhook integrated with provisioning
- [ ] Task 4: Management CLI implemented
- [ ] Task 5: Caddy reverse proxy configured
- [ ] All tests passing: `yarn test:unit && yarn test:integration`
- [ ] Manual testing: Pay for subscription → container created → accessible at URL
- [ ] Code committed and ready for production deployment

---

## Success Criteria

✅ When a user pays with Bitcoin via BTCPay:
1. Webhook fires with `InvoiceSettled` event
2. Ghost creates subscription record
3. Docker container provisioned automatically
4. Container accessible at `username.private-stack.dev`
5. Subscriber receives welcome email with login details
6. Custom domain can be added later

✅ Admin can manage containers via CLI:
- Create: `ghost subscriber create --email=user@example.com --username=username`
- List: `ghost subscriber list`
- Delete: `ghost subscriber delete --username=username`

✅ No manual intervention needed after payment

---

## Next Steps After Implementation

1. **Monitoring**: Add health checks for containers
2. **Backups**: Auto-backup SQLite databases
3. **Billing**: Track container resource usage
4. **Custom Domains**: Build UI for adding custom domains
5. **Migration**: Tools to migrate existing Ghost sites into containers
