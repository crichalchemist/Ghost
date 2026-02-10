# BTCPay Server Integration Plan for Ghost

**Goal**: Replace Stripe with BTCPay Server for privacy-focused, KYC-free crypto payments

---

## Quick Answer Summary

**Can you replace Stripe with a no-KYC crypto processor?**

✅ **YES** - BTCPay Server is the best option:
- ✅ **Zero KYC** - Completely anonymous
- ✅ **Self-hosted** - No third-party dependencies  
- ✅ **Zero fees** - Only network transaction costs
- ✅ **Open source** - Fully auditable
- ✅ **Bitcoin + Lightning Network** - Fast, low-fee options
- ⚠️ **Requires development** - 200-400 hours of work
- ⚠️ **Self-hosting required** - VPS/server infrastructure needed

---

## Phase 1: BTCPay Server Setup

### 1.1 Deploy BTCPay Server

**Option A: Docker Deployment (Recommended)**
```bash
# Clone BTCPay deployment repository
git clone https://github.com/btcpayserver/btcpayserver-docker
cd btcpayserver-docker

# Configure environment
export BTCPAY_HOST="btcpay.yourdomain.com"
export NBITCOIN_NETWORK="mainnet"  # or "testnet" for testing
export BTCPAYGEN_CRYPTO1="btc"
export BTCPAYGEN_LIGHTNING="lnd"  # Enable Lightning Network
export LETSENCRYPT_EMAIL="admin@yourdomain.com"

# Launch BTCPay
. ./btcpay-setup.sh -i

# Access at: https://btcpay.yourdomain.com
```

**Option B: LunaNode Deployment (Easiest)**
- Visit: https://launchbtcpay.lunanode.com
- One-click deployment
- Managed infrastructure
- Cost: ~$10/month

**Option C: Manual VPS Setup**
```bash
# Requirements:
# - Ubuntu 20.04+ LTS
# - 4GB RAM minimum
# - 80GB+ SSD storage
# - Docker + Docker Compose

sudo su -
cd /tmp
wget -O btcpayserver-docker.tar.gz https://github.com/btcpayserver/btcpayserver-docker/archive/master.tar.gz
tar -xvf btcpayserver-docker.tar.gz
cd btcpayserver-docker-master
# Follow setup wizard
./btcpay-setup.sh
```

### 1.2 Configure BTCPay Store

1. Create admin account at https://btcpay.yourdomain.com
2. Create a new store: "Ghost Memberships"
3. Configure Bitcoin wallet:
   - **Option A**: Use hot wallet (easier, less secure)
   - **Option B**: Connect hardware wallet (recommended for production)
4. Enable Lightning Network for instant payments
5. Generate API key: Store Settings → Access Tokens → Create Token
   - Select permissions: `btcpay.store.canmodifyinvoices`, `btcpay.store.webhooks.canmodifywebhooks`

### 1.3 Test Payment Flow

```bash
# Test invoice creation via API
curl -X POST https://btcpay.yourdomain.com/api/v1/stores/{storeId}/invoices \\
  -H "Authorization: token YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "10.00",
    "currency": "USD",
    "checkout": {
      "speedPolicy": "HighSpeed",
      "redirectURL": "https://yourghost.com/welcome"
    },
    "metadata": {
      "orderId": "test-123",
      "buyerEmail": "test@example.com"
    }
  }'
```

---

## Phase 2: Ghost Integration Architecture

### 2.1 Create Payment Abstraction Layer

**File**: `ghost/core/core/server/services/payments/payment-provider-interface.js`

```javascript
/**
 * Abstract payment provider interface
 * Allows switching between Stripe, BTCPay, or other providers
 */
class PaymentProvider {
    /**
     * Create a checkout session for a new subscription
     * @param {Object} options
     * @param {string} options.priceId - Plan identifier
     * @param {string} options.memberEmail - Member email
     * @param {string} options.successUrl - Redirect URL on success
     * @param {string} options.cancelUrl - Redirect URL on cancel
     * @returns {Promise<{sessionId: string, checkoutUrl: string}>}
     */
    async createCheckoutSession(options) {
        throw new Error('Not implemented');
    }

    /**
     * Verify webhook signature
     * @param {string} payload - Raw webhook body
     * @param {string} signature - Signature header
     * @returns {boolean}
     */
    verifyWebhookSignature(payload, signature) {
        throw new Error('Not implemented');
    }

    /**
     * Get subscription details
     * @param {string} subscriptionId
     * @returns {Promise<Object>}
     */
    async getSubscription(subscriptionId) {
        throw new Error('Not implemented');
    }

    /**
     * Cancel subscription
     * @param {string} subscriptionId
     * @returns {Promise<void>}
     */
    async cancelSubscription(subscriptionId) {
        throw new Error('Not implemented');
    }
}

module.exports = PaymentProvider;
```

### 2.2 BTCPay Provider Implementation

**File**: `ghost/core/core/server/services/payments/btcpay-provider.js`

```javascript
const PaymentProvider = require('./payment-provider-interface');
const crypto = require('crypto');
const fetch = require('node-fetch');

class BTCPayProvider extends PaymentProvider {
    constructor(config) {
        super();
        this.apiUrl = config.apiUrl; // e.g., https://btcpay.yourdomain.com
        this.apiToken = config.apiToken;
        this.storeId = config.storeId;
        this.webhookSecret = config.webhookSecret;
    }

    async createCheckoutSession(options) {
        const {priceId, memberEmail, successUrl, cancelUrl, metadata = {}} = options;
        
        // Fetch price from Ghost's tier/price system
        const price = await this._getPrice(priceId);
        
        // Create BTCPay invoice
        const invoice = await fetch(`${this.apiUrl}/api/v1/stores/${this.storeId}/invoices`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${this.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: (price.amount / 100).toFixed(2), // Convert cents to dollars
                currency: price.currency.toUpperCase(),
                checkout: {
                    speedPolicy: 'HighSpeed',
                    redirectURL: successUrl,
                    redirectAutomatically: true
                },
                metadata: {
                    ...metadata,
                    memberEmail,
                    priceId,
                    ghost_subscription: true
                }
            })
        }).then(r => r.json());

        return {
            sessionId: invoice.id,
            checkoutUrl: invoice.checkoutLink
        };
    }

    verifyWebhookSignature(payload, signature) {
        // BTCPay uses HMAC-SHA256
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
        
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(`sha256=${expectedSignature}`)
        );
    }

    async getSubscription(subscriptionId) {
        // BTCPay doesn't have native subscriptions
        // We manage this in Ghost's database
        const subscription = await this._getGhostSubscription(subscriptionId);
        return subscription;
    }

    async cancelSubscription(subscriptionId) {
        // Mark subscription as canceled in Ghost DB
        // Stop generating renewal invoices
        await this._updateGhostSubscription(subscriptionId, {
            status: 'canceled',
            cancel_at_period_end: true
        });
    }

    // Private helper methods
    async _getPrice(priceId) {
        // Fetch from Ghost's products/tiers system
        // ...implementation...
    }

    async _getGhostSubscription(subscriptionId) {
        // Fetch from members_crypto_subscriptions table
        // ...implementation...
    }

    async _updateGhostSubscription(subscriptionId, updates) {
        // Update members_crypto_subscriptions table
        // ...implementation...
    }
}

module.exports = BTCPayProvider;
```

### 2.3 Subscription Manager (Custom Recurring Logic)

**File**: `ghost/core/core/server/services/payments/subscription-manager.js`

```javascript
/**
 * Manages crypto subscriptions since BTCPay doesn't have native recurring billing
 * This service:
 * - Generates renewal invoices
 * - Tracks subscription status
 * - Handles failed payments
 * - Manages access control
 */
class SubscriptionManager {
    constructor(deps) {
        this.paymentProvider = deps.paymentProvider;
        this.memberRepository = deps.memberRepository;
        this.emailService = deps.emailService;
    }

    /**
     * Check for subscriptions that need renewal
     * Run this via cron job daily
     */
    async processRenewals() {
        const dueSubscriptions = await this._getDueSubscriptions();
        
        for (const subscription of dueSubscriptions) {
            await this._createRenewalInvoice(subscription);
        }
    }

    async _getDueSubscriptions() {
        // Find subscriptions where current_period_end is within next 7 days
        // and status is 'active' and cancel_at_period_end is false
        const knex = require('../../data/db/connection');
        
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        
        return await knex('members_crypto_subscriptions')
            .where('status', 'active')
            .where('cancel_at_period_end', false)
            .where('current_period_end', '<=', sevenDaysFromNow)
            .where('renewal_invoice_sent', false);
    }

    async _createRenewalInvoice(subscription) {
        const member = await this.memberRepository.get({id: subscription.member_id});
        
        // Create BTCPay invoice
        const invoice = await this.paymentProvider.createCheckoutSession({
            priceId: subscription.plan_id,
            memberEmail: member.email,
            successUrl: `${process.env.SITE_URL}/membership/renewed`,
            cancelUrl: `${process.env.SITE_URL}/membership/renew`,
            metadata: {
                subscription_id: subscription.id,
                renewal: true
            }
        });

        // Send email to member with payment link
        await this.emailService.send({
            to: member.email,
            subject: 'Your subscription renewal',
            html: `
                <p>Hi ${member.name},</p>
                <p>Your subscription is due for renewal.</p>
                <p><a href="${invoice.checkoutUrl}">Click here to renew</a></p>
                <p>Amount: ${subscription.amount} ${subscription.currency}</p>
            `
        });

        // Mark invoice as sent
        await this._updateSubscription(subscription.id, {
            renewal_invoice_sent: true,
            last_invoice_id: invoice.sessionId
        });
    }

    async _updateSubscription(id, updates) {
        const knex = require('../../data/db/connection');
        await knex('members_crypto_subscriptions')
            .where('id', id)
            .update({...updates, updated_at: new Date()});
    }
}

module.exports = SubscriptionManager;
```

---

## Phase 3: Webhook Handler

**File**: `ghost/core/core/server/services/payments/btcpay-webhook-controller.js`

```javascript
const crypto = require('crypto');

class BTCPayWebhookController {
    constructor(deps) {
        this.paymentProvider = deps.paymentProvider;
        this.memberRepository = deps.memberRepository;
        this.subscriptionManager = deps.subscriptionManager;
    }

    async handle(req, res) {
        const payload = JSON.stringify(req.body);
        const signature = req.headers['btcpay-sig'];

        // Verify webhook signature
        if (!this.paymentProvider.verifyWebhookSignature(payload, signature)) {
            return res.status(401).send('Invalid signature');
        }

        const event = req.body;

        try {
            switch (event.type) {
                case 'InvoiceCreated':
                    await this._handleInvoiceCreated(event);
                    break;
                case 'InvoiceProcessing':
                    await this._handleInvoiceProcessing(event);
                    break;
                case 'InvoiceSettled':
                    await this._handleInvoiceSettled(event);
                    break;
                case 'InvoiceExpired':
                    await this._handleInvoiceExpired(event);
                    break;
                case 'InvoiceInvalid':
                    await this._handleInvoiceInvalid(event);
                    break;
            }

            res.status(200).send('Webhook processed');
        } catch (error) {
            console.error('Webhook processing error:', error);
            res.status(500).send('Webhook processing failed');
        }
    }

    async _handleInvoiceSettled(event) {
        // Payment confirmed!
        const invoice = event.data;
        const metadata = invoice.metadata;

        if (metadata.renewal) {
            // This is a subscription renewal
            await this._renewSubscription(metadata.subscription_id, invoice);
        } else if (metadata.ghost_subscription) {
            // This is a new subscription
            await this._createSubscription(metadata, invoice);
        }
    }

    async _createSubscription(metadata, invoice) {
        const knex = require('../../data/db/connection');
        
        // Find or create member
        let member = await this.memberRepository.get({email: metadata.memberEmail});
        if (!member) {
            member = await this.memberRepository.create({
                email: metadata.memberEmail,
                status: 'paid'
            });
        }

        // Create subscription record
        const subscriptionId = require('crypto').randomUUID();
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1); // 1 month from now

        await knex('members_crypto_subscriptions').insert({
            id: subscriptionId,
            member_id: member.id,
            provider: 'btcpay',
            subscription_id: invoice.id,
            plan_id: metadata.priceId,
            status: 'active',
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: false,
            created_at: new Date(),
            updated_at: new Date()
        });

        // Update member status to 'paid'
        await this.memberRepository.update({id: member.id}, {
            status: 'paid'
        });
    }

    async _renewSubscription(subscriptionId, invoice) {
        const knex = require('../../data/db/connection');
        
        // Update subscription period
        const subscription = await knex('members_crypto_subscriptions')
            .where('id', subscriptionId)
            .first();

        const newPeriodEnd = new Date(subscription.current_period_end);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

        await knex('members_crypto_subscriptions')
            .where('id', subscriptionId)
            .update({
                current_period_end: newPeriodEnd,
                renewal_invoice_sent: false,
                updated_at: new Date()
            });

        // Record the invoice
        await knex('members_crypto_invoices').insert({
            id: require('crypto').randomUUID(),
            subscription_id: subscriptionId,
            invoice_id: invoice.id,
            amount_crypto: invoice.cryptoPaid,
            amount_fiat: invoice.amount * 100, // convert to cents
            currency: invoice.currency,
            status: 'paid',
            paid_at: new Date(),
            created_at: new Date()
        });
    }

    async _handleInvoiceExpired(event) {
        // Payment wasn't made in time
        const invoice = event.data;
        const metadata = invoice.metadata;

        if (metadata.renewal) {
            // Mark subscription as past_due
            await this._updateSubscription(metadata.subscription_id, {
                status: 'past_due'
            });
            
            // Send reminder email
            // ...
        }
    }

    async _updateSubscription(id, updates) {
        const knex = require('../../data/db/connection');
        await knex('members_crypto_subscriptions')
            .where('id', id)
            .update({...updates, updated_at: new Date()});
    }
}

module.exports = BTCPayWebhookController;
```

---

## Phase 4: Database Migrations

**File**: `ghost/core/core/server/data/migrations/versions/6.0/2026-02-10-add-crypto-payments.js`

```javascript
const {createAddColumnMigration} = require('../../utils');

module.exports = createAddColumnMigration('members_crypto_providers', 'members_crypto_subscriptions', 'members_crypto_invoices');

// Or more explicit:
module.exports = {
    config: {
        transaction: true
    },

    async up(knex) {
        // Create crypto providers table
        await knex.schema.createTable('members_crypto_providers', function (table) {
            table.string('id', 24).primary();
            table.string('member_id', 24).notNullable();
            table.string('provider', 50).notNullable();
            table.string('customer_id', 255);
            table.dateTime('created_at').notNullable();
            table.dateTime('updated_at');
            
            table.foreign('member_id').references('members.id').onDelete('CASCADE');
            table.index('member_id');
        });

        // Create crypto subscriptions table
        await knex.schema.createTable('members_crypto_subscriptions', function (table) {
            table.string('id', 24).primary();
            table.string('member_id', 24).notNullable();
            table.string('provider', 50).notNullable();
            table.string('subscription_id', 255);
            table.string('plan_id', 255);
            table.string('status', 50).notNullable();
            table.dateTime('current_period_end');
            table.boolean('cancel_at_period_end').defaultTo(false);
            table.boolean('renewal_invoice_sent').defaultTo(false);
            table.string('last_invoice_id', 255);
            table.integer('amount');
            table.string('currency', 10);
            table.dateTime('created_at').notNullable();
            table.dateTime('updated_at');
            
            table.foreign('member_id').references('members.id').onDelete('CASCADE');
            table.index('member_id');
            table.index('status');
            table.index('current_period_end');
        });

        // Create crypto invoices table
        await knex.schema.createTable('members_crypto_invoices', function (table) {
            table.string('id', 24).primary();
            table.string('subscription_id', 24);
            table.string('invoice_id', 255).notNullable();
            table.string('amount_crypto', 50);
            table.integer('amount_fiat');
            table.string('currency', 10);
            table.string('status', 50).notNullable();
            table.dateTime('paid_at');
            table.dateTime('created_at').notNullable();
            
            table.foreign('subscription_id').references('members_crypto_subscriptions.id').onDelete('SET NULL');
            table.index('subscription_id');
            table.index('invoice_id');
        });
    },

    async down(knex) {
        await knex.schema.dropTableIfExists('members_crypto_invoices');
        await knex.schema.dropTableIfExists('members_crypto_subscriptions');
        await knex.schema.dropTableIfExists('members_crypto_providers');
    }
};
```

---

## Phase 5: Portal UI Updates

**File**: `apps/portal/src/components/pages/PaymentMethodPage.js`

Add crypto payment option:

```javascript
// ...existing imports...

function PaymentMethodSelector({onSelect}) {
    return (
        <div className="payment-methods">
            <button onClick={() => onSelect('stripe')}>
                Credit Card (Stripe)
            </button>
            <button onClick={() => onSelect('btcpay')}>
                Bitcoin / Lightning Network
            </button>
        </div>
    );
}

function BTCPayCheckout({checkoutUrl}) {
    // Redirect to BTCPay checkout page
    useEffect(() => {
        if (checkoutUrl) {
            window.location.href = checkoutUrl;
        }
    }, [checkoutUrl]);

    return (
        <div className="btcpay-checkout">
            <p>Redirecting to secure Bitcoin payment...</p>
            <div className="spinner" />
        </div>
    );
}

// Update SignupPage component to support payment method selection
```

---

## Phase 6: Cron Job for Renewals

**File**: `ghost/core/core/server/services/payments/renewal-scheduler.js`

```javascript
const cron = require('node-cron');

class RenewalScheduler {
    constructor(subscriptionManager) {
        this.subscriptionManager = subscriptionManager;
        this.job = null;
    }

    start() {
        // Run daily at 9 AM
        this.job = cron.schedule('0 9 * * *', async () => {
            console.log('Processing subscription renewals...');
            try {
                await this.subscriptionManager.processRenewals();
                console.log('Renewals processed successfully');
            } catch (error) {
                console.error('Renewal processing failed:', error);
            }
        });
    }

    stop() {
        if (this.job) {
            this.job.stop();
        }
    }
}

module.exports = RenewalScheduler;
```

Register in Ghost's boot process:

```javascript
// In ghost/core/core/server/services/index.js
const RenewalScheduler = require('./payments/renewal-scheduler');

// Start scheduler
const renewalScheduler = new RenewalScheduler(subscriptionManager);
renewalScheduler.start();
```

---

## Configuration

**File**: `ghost/core/config.production.json`

```json
{
  "payments": {
    "provider": "btcpay",
    "btcpay": {
      "apiUrl": "https://btcpay.yourdomain.com",
      "apiToken": "YOUR_BTCPAY_API_TOKEN",
      "storeId": "YOUR_STORE_ID",
      "webhookSecret": "YOUR_WEBHOOK_SECRET"
    }
  }
}
```

**File**: `.env`

```bash
# BTCPay Server Configuration
BTCPAY_API_URL=https://btcpay.yourdomain.com
BTCPAY_API_TOKEN=your_api_token_here
BTCPAY_STORE_ID=your_store_id_here
BTCPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

---

## Testing Checklist

- [ ] BTCPay server deployed and accessible
- [ ] API token created with correct permissions
- [ ] Test invoice creation via API
- [ ] Webhook endpoint configured in BTCPay
- [ ] Webhook signature verification working
- [ ] Test payment flow (testnet Bitcoin)
- [ ] Test subscription creation
- [ ] Test renewal invoice generation
- [ ] Test failed payment handling
- [ ] Test subscription cancellation
- [ ] Test member access control
- [ ] Load testing with multiple concurrent payments

---

## Deployment Steps

1. **Deploy BTCPay Server** (production environment)
2. **Run database migrations** (`yarn knex-migrator migrate`)
3. **Deploy Ghost code** with BTCPay integration
4. **Configure webhooks** in BTCPay admin panel
5. **Test with small amounts** before full launch
6. **Monitor logs** for first 24-48 hours
7. **Document process** for team members

---

## Estimated Timeline

- BTCPay deployment: 1-2 days
- Core integration dev: 6-8 weeks
- UI development: 2-3 weeks
- Testing: 2-4 weeks
- Deployment: 1 week

**Total: 12-18 weeks**

---

## Maintenance Requirements

**Daily**:
- Monitor renewal cron job execution
- Check for failed payments

**Weekly**:
- Review subscription statuses
- Check BTCPay server health

**Monthly**:
- Update BTCPay server
- Review crypto transaction fees
- Backup Bitcoin wallet

---

**Next Step**: Start with BTCPay Server deployment and test the API integration before building the full Ghost integration.

