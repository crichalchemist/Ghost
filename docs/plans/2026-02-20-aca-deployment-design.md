# PrivateStack ACA Deployment Design

**Date**: February 20, 2026
**Status**: Design Complete - Ready for Implementation
**Branch**: feat/pvtpmnt

---

## Summary

Deploy subscriber Ghost instances as Azure Container Apps (ACA) instead of Docker containers on a VM. The main Ghost platform and BTCPay Server remain on Azure VMs (`rentfall` and `slimer-osmosis`). Each paying subscriber gets an isolated Container App with its own Azure File Share for persistent storage, managed SSL, and automatic subdomain routing via ACA's built-in Envoy ingress.

---

## Architecture

```
                     Internet
                        |
                        v
    +----------------------------------------------+
    |  ACA Environment: privatestack-env            |
    |  (Built-in Envoy ingress)                     |
    |  *.private-stack.dev wildcard cert             |
    |                                               |
    |  +----------+ +----------+ +----------+      |
    |  | App:     | | App:     | | App:     |      |
    |  | alice    | | bob      | | charlie  |      |
    |  | Ghost    | | Ghost    | | Ghost    |      |
    |  | :2368    | | :2368    | | :2368    |      |
    |  |          | |          | |          |      |
    |  | Azure    | | Azure    | | Azure    |      |
    |  | File     | | File     | | File     |      |
    |  | Share    | | Share    | | Share    |      |
    |  +----------+ +----------+ +----------+      |
    |                                               |
    |  VNet: privatestack-vnet                      |
    +----------------------------------------------+
                        |
           +------------+----------------+
           v                             v
     +--------------+           +--------------+
     | VM: rentfall |           | VM: slimer   |
     | Ghost Main   |           | BTCPay       |
     | MySQL, Redis |           |              |
     +--------------+           +--------------+
     Subnet: vm-subnet          Subnet: vm-subnet
```

### Why ACA over ACI

- **Built-in ingress**: Handles wildcard domain routing and SSL natively. No Application Gateway needed.
- **Managed SSL**: Free managed certificates, auto-renewal for custom domains.
- **Same cost model**: Pay per-second of allocated CPU/RAM (ACI pricing underneath).
- **Better health probes**: Liveness, readiness, and startup probes.
- **Service discovery**: Built-in between containers in same environment.

### What's eliminated vs original Docker-on-VM plan

- No Caddy reverse proxy configuration management
- No port allocation logic (each app gets its own FQDN)
- No Docker socket access needed
- No manual SSL certificate management
- No Application Gateway ($20+/month saved)

---

## Azure Infrastructure (One-Time Setup)

### Existing resources (no changes)

- **Resource Group**: `GHOST-PLATFORM-RG` (France Central)
- **VNet**: `privatestack-vnet`
- **VM**: `rentfall` (Standard_B4s_v2) — Ghost platform, MySQL, Redis
- **VM**: `slimer-osmosis` (Standard_B2as_v2) — BTCPay Server
- **Load Balancer**: `ghostbusters`

### New resources to create

1. **Storage Account**: `privatestackstorage`
   - SKU: Standard_LRS
   - Location: France Central
   - Purpose: Host Azure File Shares for subscriber content + SQLite databases
   - Each subscriber gets a share: `ghost-{username}`

2. **ACA Environment**: `privatestack-env`
   - VNet-integrated (subnet: `aca-subnet`)
   - Infrastructure type: Consumption (pay per use)
   - Log destination: Azure Monitor (optional)
   - Workload profiles: Consumption (default)

3. **VNet Subnet**: `aca-subnet`
   - CIDR: `10.0.4.0/23` (ACA requires minimum /23)
   - Delegation: `Microsoft.App/environments`
   - Must have connectivity to `vm-subnet` for SMTP relay to rentfall

4. **DNS Zone**: `private-stack.dev`
   - Wildcard CNAME: `*.private-stack.dev` -> ACA environment default domain
   - A record: `private-stack.dev` -> rentfall VM public IP
   - Required for ACA managed certificate validation

---

## Container App Specification

Each subscriber becomes a Container App:

```
Container App: ghost-sub-{username}
  Environment: privatestack-env
  Image: ghost:5-alpine
  Resources: 0.5 vCPU, 1 GB RAM
  Min replicas: 1 (always on, no cold starts)
  Max replicas: 1 (SQLite doesn't support concurrent writers)
  Ingress:
    External: true
    Target port: 2368
    Custom domain: {username}.private-stack.dev (managed cert)
  Env vars:
    NODE_ENV=production
    url=https://{username}.private-stack.dev
  Volume mounts:
    /var/lib/ghost/content -> Azure File Share: ghost-{username}
  Tags:
    subscriber-username: {username}
    subscriber-member-id: {member_id}
    managed: true
```

### Storage per subscriber

Each Azure File Share contains:
```
ghost-{username}/
  config.production.json     # Ghost config (uploaded before container start)
  data/
    ghost-{username}.db      # SQLite database (created by Ghost on first run)
  images/                    # Uploaded images
  themes/                    # Ghost themes
  logs/                      # Ghost logs
```

---

## Code Changes

### New file: `aca-manager.js`

Replaces DockerManager for production. Uses Azure SDK:
- `@azure/arm-appcontainers` — create/delete Container Apps
- `@azure/identity` — authenticate (DefaultAzureCredential)
- `@azure/storage-file-share` — create file shares, upload config

```
class AcaManager {
    constructor(options)
        // Azure SDK clients (injected for testing)
        // Config: resourceGroup, environmentName, storageAccountName, location, domain

    async createSubscriberContainer(subscriber)
        // 1. Create Azure File Share + upload config.production.json
        // 2. Create Container App with volume mount + ingress
        // 3. Add custom domain binding with managed cert
        // 4. Write to subscribers table + container events
        // Returns: {containerAppName, fqdn, url, subscriberId}

    async deleteSubscriberContainer(subscriberUsername)
        // 1. Delete Container App
        // 2. Delete Azure File Share
        // 3. Log deletion event + remove from database

    async getSubscriberStatus(subscriberUsername)
        // Query ACA API for container app provisioning/running state

    generateGhostConfig(subscriber)
        // Ghost config with:
        //   url: https://{username}.private-stack.dev
        //   port: 2368
        //   database: sqlite3 at /var/lib/ghost/content/data/ghost-{username}.db
        //   mail: SMTP via rentfall private IP
}
```

### Modified file: `index.js` (SubscriberProvisioningService)

Environment-aware manager selection:

```javascript
constructor(config = {}) {
    if (config.provider === 'aca' || process.env.GHOST_CONTAINER_PROVIDER === 'aca') {
        const AcaManager = require('./aca-manager');
        this.manager = config.acaManager || new AcaManager(config.aca);
    } else {
        const DockerManager = require('./docker-manager');
        this.manager = config.dockerManager || new DockerManager(config.docker);
    }
}
```

- `provisionSubscriber()` calls `this.manager.createSubscriberContainer()`
- `deprovisionSubscriber()` calls `this.manager.deleteSubscriberContainer()`
- Caddy update logic removed from production path (kept for Docker/local dev)

### Unchanged files

- `docker-manager.js` — kept for local development
- `config-generator.js` — kept for local Caddy dev
- Database migration — `container_id` column stores ACA container app name
- BTCPay webhook controller — calls `provisionSubscriber()` (unchanged interface)
- CLI management tool — calls provisioning service (unchanged interface)
- All existing unit tests for orchestration layer

### New dependencies

```json
{
  "@azure/arm-appcontainers": "^2.0.0",
  "@azure/identity": "^4.0.0",
  "@azure/storage-file-share": "^12.0.0"
}
```

---

## Provisioning Flow

```
BTCPay webhook (InvoiceSettled)
    |
    v
SubscriberProvisioningService.provisionSubscriber()
    |
    +-- 1. Create Azure File Share: ghost-{username}
    |       Upload config.production.json to share
    |
    +-- 2. Create Container App: ghost-sub-{username}
    |       - Image: ghost:5-alpine
    |       - 0.5 vCPU, 1 GB RAM, min/max replicas: 1
    |       - Mount file share as volume
    |       - Enable external ingress on port 2368
    |
    +-- 3. Add custom domain binding
    |       {username}.private-stack.dev -> container app
    |       Managed cert auto-provisioned by ACA
    |
    +-- 4. Write subscriber record to database
    |       subscribers table: status='provisioning' -> 'running'
    |       subscriber_container_events: event_type='created'
    |
    +-- 5. Return {url, containerAppName, fqdn, subscriberId}
```

### Deprovisioning Flow

```
CLI or admin action
    |
    v
SubscriberProvisioningService.deprovisionSubscriber(username)
    |
    +-- 1. Look up subscriber in database
    +-- 2. Delete Container App via ACA API
    +-- 3. Delete Azure File Share (content + database)
    +-- 4. Log deletion event
    +-- 5. Remove subscriber record from database
```

---

## Environment Configuration

### Production (Azure)

```json
{
  "containerProvider": "aca",
  "aca": {
    "resourceGroup": "GHOST-PLATFORM-RG",
    "environmentName": "privatestack-env",
    "storageAccountName": "privatestackstorage",
    "storageAccountKey": "<from-env-var>",
    "location": "francecentral",
    "domain": "private-stack.dev",
    "ghostImage": "ghost:5-alpine",
    "cpu": 0.5,
    "memoryGi": 1.0
  }
}
```

### Local development (Docker)

```json
{
  "containerProvider": "docker",
  "docker": {
    "subscribersPath": "/home/crichalchemist/subscribers",
    "basePort": 2370,
    "network": "privatestack-subscribers"
  }
}
```

---

## Cost Estimate

### Per subscriber (always-on)

- ACA: 0.5 vCPU + 1 GB RAM ~ $19/month
- Azure File Share: ~$0.06/GB/month (negligible)
- **Total: ~$19/month per subscriber**

### Platform infrastructure

- ACA Environment: Free (consumption plan)
- Storage Account: $0.06/GB/month base
- DNS Zone: ~$0.50/month
- VMs (existing): unchanged

### With $10k credits

At $19/month per subscriber, credits support ~526 subscriber-months (or ~52 subscribers for 10 months).

---

## Testing Strategy

- Unit tests: Mock Azure SDK clients, test provisioning logic
- Integration tests: Use Azure SDK against real ACA environment (dev/staging)
- E2E test: Trigger BTCPay webhook -> verify Container App created -> verify site accessible at subdomain
- Keep Docker-based tests for local development path

---

## Implementation Order

1. One-time Azure infrastructure setup (Storage Account, ACA Environment, VNet subnet, DNS)
2. Create `aca-manager.js` with Azure SDK integration
3. Modify `index.js` for environment-aware manager selection
4. Add Azure SDK dependencies
5. Unit tests for AcaManager (mocked SDK)
6. Integration test against real Azure (provision + verify + deprovision)
7. Update CLI tool and webhook controller config
8. Deploy to production

---

## Success Criteria

- When a subscriber pays via BTCPay, a Container App is provisioned within 90 seconds
- Subscriber site is accessible at `{username}.private-stack.dev` with managed SSL
- Subscriber data persists across container restarts (Azure File Share)
- Admin can create/list/delete subscriber containers via CLI
- Local development still uses Docker (no Azure dependency for dev)
