# Dual Payment System Deployment Guide
## Stripe ($10/year) + BTCPay ($30/year)

---

## Overview

This guide walks through deploying the dual payment system where Ghost accepts both:
- **Stripe**: $10/year (traditional payment)
- **BTCPay Server**: $30/year (Bitcoin/Lightning, no KYC)

---

## Prerequisites

- [ ] Ghost instance running (v6.0+)
- [ ] Node.js v18+ and Yarn installed
- [ ] VPS/server for BTCPay Server (4GB RAM, 80GB SSD minimum)
- [ ] Domain name for BTCPay (e.g., `btcpay.yourdomain.com`)
- [ ] Stripe account (existing)

---

## Phase 1: Database Setup

### Step 1: Run Migrations

```bash
cd /Volumes/Containers/Ghost

# Run the crypto payments migration
yarn knex-migrator migrate

# Verify tables were created
yarn knex-migrator list
```

**Expected Output:**
```
✓ members_crypto_providers
✓ members_crypto_subscriptions  
✓ members_crypto_invoices
```

### Step 2: Verify Database Schema

```bash
# Connect to MySQL
yarn docker:mysql

# Check tables
SHOW TABLES LIKE 'members_crypto%';
DESCRIBE members_crypto_subscriptions;
```

---

## Phase 2: BTCPay Server Deployment

### Option A: Docker Deployment (Recommended)  <- done

```bash
# On your VPS/server
ssh user@your-server.com

# Clone BTCPay deployment
git clone https://github.com/btcpayserver/btcpayserver-docker
cd btcpayserver-docker

# Configure
export BTCPAY_HOST="btcpay.yourdomain.com"
export NBITCOIN_NETWORK="mainnet"  # or "testnet" for testing
export BTCPAYGEN_CRYPTO1="btc"
export BTCPAYGEN_LIGHTNING="lnd"
export LETSENCRYPT_EMAIL="admin@yourdomain.com"

# Launch
. ./btcpay-setup.sh -i
```

### Option B: LunaNode (Easiest)

1. Visit: https://launchbtcpay.lunanode.com
2. Click "Launch BTCPay Server"
3. Enter domain: `btcpay.yourdomain.com`
4. Select Bitcoin + Lightning Network
5. Wait 15-20 minutes for deployment

### Step 3: Configure DNS

Point your domain to BTCPay server:

```
A Record: payment.private-stack.dev → YOUR_SERVER_IP   <- done
```

Wait for DNS propagation (5-60 minutes).

### Step 4: Initial BTCPay Setup      <- done

1. Access: `https://btcpay.yourdomain.com`
2. Create admin account
3. Create a new store: "Ghost Memberships"
4. Configure Bitcoin wallet:
   - Go to Store Settings → Wallets
   - Generate new wallet or import existing
   - **IMPORTANT**: Backup your seed phrase securely!

5. Enable Lightning Network:
   - Store Settings → Lightning
   - Connect to LND node
   - Create Lightning wallet         

---

## Phase 3: BTCPay API Configuration

### Step 1: Generate API Token

1. In BTCPay: User → Account → API Keys
2. Click "Generate Key"
3. Select permissions:
   - ✅ `btcpay.store.canmodifyinvoices`
   - ✅ `btcpay.store.canviewinvoices`
   - ✅ `btcpay.store.webhooks.canmodifywebhooks`
   - ✅ `btcpay.store.canviewstoresettings`
4. Label: "Ghost Integration"
5. Click "Generate API Key"
6. **COPY AND SAVE** the API token (shown once!)  <- done

### Step 2: Get Store ID

1. In BTCPay: Store Settings → General
2. Copy "Store ID" (looks like: `ABcD1234EfGH5678`) <-done

### Step 3: Create Webhook Secret

```bash
# Generate a random webhook secret
openssl rand -hex 32
```

Save this secret - you'll need it for Ghost configuration. <- done

---

## Phase 4: Ghost Configuration

### Step 1: Update Environment Variables

Edit your `.env` file:

```bash
# BTCPay Server Configuration
BTCPAY_API_URL=https://btcpay.yourdomain.com
BTCPAY_API_TOKEN=your_api_token_here
BTCPAY_STORE_ID=your_store_id_here
BTCPAY_WEBHOOK_SECRET=your_webhook_secret_here

# Site URL (important for redirects)
SITE_URL=https://yourghost.com
```

### Step 2: Update Stripe Pricing

In BTCPay dashboard, you need to update your Stripe pricing to $10/year:

1. Go to Stripe Dashboard → Products
2. Update your annual product price to $10.00
3. Copy the new Price ID (starts with `price_`)
4. Update `pricing-config.js`:

```javascript
// In ghost/core/core/server/services/payments/pricing-config.js
stripe: {
    price_id: 'price_YOUR_NEW_STRIPE_PRICE_ID', // Update this
    amount: 1000, // $10.00
    // ...
}
```

### Step 3: Configure Webhooks in BTCPay

1. In BTCPay: Store Settings → Webhooks
2. Click "Create Webhook"
3. Configuration:
   - **Payload URL**: `https://yourghost.com/webhooks/btcpay/`
   - **Secret**: (use the webhook secret you generated)
   - **Events**: Select all invoice events:
     - InvoiceCreated
     - InvoiceReceivedPayment
     - InvoiceProcessing
     - InvoiceSettled
     - InvoiceExpired
     - InvoiceInvalid
   - **Active**: ✅ Enabled
4. Click "Add Webhook"

---

## Phase 5: Ghost Code Integration

### Step 1: Register Payment Service

Create/update: `ghost/core/core/server/services/index.js`

```javascript
// Add near other service initializations
const PaymentService = require('./payments');
const BTCPayWebhookController = require('./payments/btcpay-webhook-controller');

// Initialize payment service
const paymentService = new PaymentService({
    stripeConfig: config.get('stripe'),
    stripeProvider: require('./stripe'), // Existing Stripe service
    btcpayConfig: {
        apiUrl: process.env.BTCPAY_API_URL,
        apiToken: process.env.BTCPAY_API_TOKEN,
        storeId: process.env.BTCPAY_STORE_ID,
        webhookSecret: process.env.BTCPAY_WEBHOOK_SECRET
    }
});

// Initialize BTCPay webhook controller
const btcpayWebhookController = new BTCPayWebhookController({
    paymentService,
    memberRepository: require('./members').repository,
    labs: require('../shared/labs')
});

module.exports = {
    // ...existing exports
    paymentService,
    btcpayWebhookController
};
```

### Step 2: Add Webhook Route

In `ghost/core/core/server/web/api/endpoints/members/routes.js`:

```javascript
// Add BTCPay webhook route
router.post(
    '/webhooks/btcpay',
    bodyParser.raw({type: 'application/json'}),
    async (req, res) => {
        const {btcpayWebhookController} = require('../../../../services');
        await btcpayWebhookController.handle(req, res);
    }
);
```

---

## Phase 6: Portal UI Updates

### Update Checkout Page

Edit: `apps/portal/src/components/pages/SignupPage.js`

Add payment method selector:

```javascript
import React, {useState} from 'react';
// ...existing imports

const SignupPage = () => {
    const [paymentMethod, setPaymentMethod] = useState('stripe');
    const [pricingOptions, setPricingOptions] = useState(null);

    // Fetch pricing options on mount
    useEffect(() => {
        fetch('/ghost/api/members/pricing')
            .then(r => r.json())
            .then(data => setPricingOptions(data));
    }, []);

    return (
        <div className="signup-page">
            <h2>Choose Your Payment Method</h2>
            
            {/* Payment Method Selector */}
            <div className="payment-methods">
                <button 
                    className={paymentMethod === 'stripe' ? 'active' : ''}
                    onClick={() => setPaymentMethod('stripe')}
                >
                    <h3>Credit Card</h3>
                    <p className="price">$10/year</p>
                    <p className="note">Standard pricing</p>
                </button>

                <button 
                    className={paymentMethod === 'btcpay' ? 'active' : ''}
                    onClick={() => setPaymentMethod('btcpay')}
                >
                    <h3>Bitcoin</h3>
                    <p className="price">$30/year</p>
                    <p className="note">Privacy premium - No KYC required</p>
                    <ul className="features">
                        <li>✨ Complete anonymity</li>
                        <li>✨ Lightning Network supported</li>
                        <li>✨ Censorship-resistant</li>
                    </ul>
                </button>
            </div>

            {/* Checkout Button */}
            <button onClick={() => handleCheckout(paymentMethod)}>
                Continue to {paymentMethod === 'stripe' ? 'Stripe' : 'Bitcoin'} Checkout
            </button>
        </div>
    );
};
```

### Add Pricing API Endpoint

Create: `ghost/core/core/server/api/endpoints/members/pricing.js`

```javascript
module.exports = {
    docName: 'pricing',

    browse: {
        headers: {
            cacheInvalidate: false
        },
        permissions: false,
        query() {
            const {getAllPricingOptions} = require('../../../services/payments/pricing-config');
            return getAllPricingOptions('annual_membership');
        }
    }
};
```

---

## Phase 7: Testing

### Test BTCPay Integration

#### 1. Test Invoice Creation

```bash
# Test creating an invoice via API
curl -X POST https://btcpay.yourdomain.com/api/v1/stores/YOUR_STORE_ID/invoices \\
  -H "Authorization: token YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "30.00",
    "currency": "USD",
    "checkout": {
      "speedPolicy": "HighSpeed",
      "redirectURL": "https://yourghost.com/welcome"
    },
    "metadata": {
      "test": true,
      "memberEmail": "test@example.com"
    }
  }'
```

#### 2. Test Webhook Delivery

1. In BTCPay: Store → Webhooks → (your webhook)
2. Click "Redeliver" on any event
3. Check Ghost logs for webhook receipt

#### 3. Test Full Payment Flow (Testnet)

1. Set BTCPay to testnet mode
2. Visit: `https://yourghost.com/signup`
3. Select Bitcoin payment
4. Complete testnet Bitcoin payment
5. Verify:
   - Webhook received
   - Subscription created in database
   - Member status updated to "paid"

---

## Phase 8: Production Deployment

### Checklist

- [ ] BTCPay running on mainnet (not testnet)
- [ ] Database migrations completed
- [ ] Environment variables configured
- [ ] Webhooks registered and tested
- [ ] Stripe pricing updated to $10/year
- [ ] Portal UI updated with payment selector
- [ ] Test transaction completed successfully
- [ ] Backup wallet seed phrase secured
- [ ] Monitoring/logging configured

### Deploy to Production

```bash
cd /Volumes/Containers/Ghost

# Build Ghost with new payment service
yarn build

# Restart Ghost
# If using Docker:
yarn docker:restart

# If using PM2:
pm2 restart ghost

# Monitor logs
yarn docker:logs  # or: pm2 logs ghost
```

---

## Monitoring & Maintenance

### Daily Checks

```bash
# Check for pending renewals
echo "SELECT COUNT(*) FROM members_crypto_subscriptions 
      WHERE current_period_end < DATE_ADD(NOW(), INTERVAL 7 DAY) 
      AND status = 'active'" | yarn docker:mysql

# Check BTCPay server health
curl https://btcpay.yourdomain.com/api/v1/health
```

### Weekly Tasks

- Review BTCPay server logs
- Check Bitcoin wallet balance
- Verify webhook delivery success rate
- Review failed payments

### Monthly Tasks

- Update BTCPay Server (if self-hosted)
- Backup Bitcoin wallet
- Review pricing and adjust if needed
- Analyze conversion rates by payment method

---

## Cron Job for Renewals

Create: `ghost/core/core/server/services/payments/renewal-cron.js`

```javascript
const cron = require('node-cron');

// Run daily at 9 AM
const renewalJob = cron.schedule('0 9 * * *', async () => {
    const knex = require('../../data/db/connection');
    const {paymentService} = require('../index');
    
    // Find subscriptions due for renewal (within next 7 days)
    const dueSubscriptions = await knex('members_crypto_subscriptions')
        .where('status', 'active')
        .where('cancel_at_period_end', false)
        .where('renewal_invoice_sent', false)
        .where('current_period_end', '<=', knex.raw('DATE_ADD(NOW(), INTERVAL 7 DAY)'));
    
    for (const subscription of dueSubscriptions) {
        // Send renewal email with payment link
        // Implementation in next update
    }
});

module.exports = renewalJob;
```

---

## Troubleshooting

### BTCPay Server Not Accessible

```bash
# Check BTCPay container status
docker ps | grep btcpay

# View BTCPay logs
docker logs btcpayserver_btcpayserver_1

# Restart BTCPay
cd /path/to/btcpayserver-docker
./btcpay-down.sh
./btcpay-up.sh
```

### Webhooks Not Received

1. Check webhook URL is publicly accessible
2. Verify webhook secret matches
3. Check Ghost logs for errors
4. Test webhook delivery manually in BTCPay UI

### Payment Not Creating Subscription

1. Check Ghost logs for webhook errors
2. Verify database tables exist
3. Check BTCPay invoice metadata
4. Verify member email is valid

---

## Cost Summary

### Infrastructure Costs

**BTCPay Server (Self-Hosted)**:
- VPS (4GB RAM): $20-40/month
- Domain: $15/year
- **Total**: ~$250-500/year

**BTCPay Server (LunaNode)**:
- Managed hosting: $10/month
- **Total**: ~$120/year

### Transaction Costs

**Per Member Annual Subscription**:

**Stripe ($10/year)**:
- Fee: 2.9% + $0.30 = $0.59
- Net revenue: $9.41

**Bitcoin ($30/year)**:
- Network fee: ~$2-5 (variable)
- Net revenue: $25-28

**Profit difference**: Bitcoin subscribers generate +165% more revenue

---

## Next Steps

1. ✅ Deploy BTCPay Server
2. ✅ Configure Ghost environment variables
3. ✅ Test payment flows
4. ⏭️ Update Portal UI (cosmetic improvements)
5. ⏭️ Add email notifications for renewals
6. ⏭️ Build admin dashboard for crypto subscriptions
7. ⏭️ Add analytics tracking

---

## Support Resources

- BTCPay Docs: https://docs.btcpayserver.org
- BTCPay Community: https://chat.btcpayserver.org
- Ghost Docs: https://ghost.org/docs/
- This repo's guides:
  - `BTCPAY_IMPLEMENTATION_GUIDE.md`
  - `CRYPTO_PAYMENT_ALTERNATIVES.md`
  - `DUAL_PAYMENT_IMPLEMENTATION.md`

---

**Status**: Ready for deployment! 🚀

