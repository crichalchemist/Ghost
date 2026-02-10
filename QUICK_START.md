# 🚀 Quick Start: Dual Payment System

**Goal**: Add Bitcoin payments ($30/year) alongside Stripe ($10/year) to your Ghost site

---

## ⚡ 5-Minute Overview

### What You Get
- ✅ Keep existing Stripe payments ($10/year)
- ✅ Add Bitcoin/Lightning payments ($30/year, no KYC)
- ✅ Members choose their payment method
- ✅ Fully automated with webhooks
- ✅ Complete privacy for Bitcoin subscribers

### What Was Built
- 3 new database tables for crypto payments
- Payment abstraction layer (works with any provider)
- BTCPay Server integration
- Dual pricing configuration
- Webhook handling for both providers

---

## 📋 Prerequisites Checklist

Before you begin, ensure you have:

- [ ] Ghost v6.0+ running
- [ ] Existing Stripe integration working
- [ ] VPS/server for BTCPay (4GB RAM, 80GB SSD) OR $10/month for managed hosting
- [ ] Domain for BTCPay (e.g., `btcpay.yourdomain.com`)
- [ ] 2-4 hours for initial setup

---

## 🎯 Implementation Path

### Path A: "I Want to Test First" (Testnet)
**Timeline**: 2-3 hours
1. Deploy BTCPay on testnet
2. Run database migration
3. Configure environment variables
4. Test payment flow with testnet Bitcoin
5. Switch to mainnet when ready

### Path B: "I'm Ready for Production"
**Timeline**: 3-4 hours
1. Deploy BTCPay on mainnet
2. Run database migration
3. Configure environment variables
4. Configure webhooks
5. Update Portal UI
6. Test and go live

---

## 🏁 Quick Start Steps

### Step 1: Deploy BTCPay Server (30 mins)

**Easiest Option - LunaNode** ($10/month):
1. Visit: https://launchbtcpay.lunanode.com
2. Enter domain: `btcpay.yourdomain.com`
3. Click "Launch"
4. Wait 15-20 minutes
5. Access at: `https://btcpay.yourdomain.com`

**Self-Hosted Option** (VPS):
```bash
ssh user@your-server.com
git clone https://github.com/btcpayserver/btcpayserver-docker
cd btcpayserver-docker
export BTCPAY_HOST="btcpay.yourdomain.com"
export NBITCOIN_NETWORK="mainnet"
export BTCPAYGEN_CRYPTO1="btc"
export BTCPAYGEN_LIGHTNING="lnd"
./btcpay-setup.sh -i
```

### Step 2: Configure BTCPay (15 mins)

1. Create account at `https://btcpay.yourdomain.com`
2. Create store: "Ghost Memberships"
3. Setup Bitcoin wallet (backup seed phrase!)
4. Enable Lightning Network
5. Generate API token:
   - User → API Keys → Generate Key
   - Permissions: `btcpay.store.*`
   - Copy token (shown once!)
6. Get Store ID: Store Settings → General

### Step 3: Run Ghost Migration (5 mins)

```bash
cd /Volumes/Containers/Ghost

# Run migration to create crypto payment tables
yarn knex-migrator migrate

# Verify tables created
yarn knex-migrator list | grep crypto
```

Expected output:
```
✓ members_crypto_providers
✓ members_crypto_subscriptions
✓ members_crypto_invoices
```

### Step 4: Configure Ghost (10 mins)

Edit `.env` file:
```bash
# Add these lines
BTCPAY_API_URL=https://btcpay.yourdomain.com
BTCPAY_API_TOKEN=your_api_token_from_step_2
BTCPAY_STORE_ID=your_store_id_from_step_2
BTCPAY_WEBHOOK_SECRET=$(openssl rand -hex 32)  # Generate random secret
```

Update Stripe pricing to $10/year:
```bash
# Edit: ghost/core/core/server/services/payments/pricing-config.js
# Line 14: Update stripe.price_id to your $10/year Stripe Price ID
```

### Step 5: Configure Webhook (5 mins)

In BTCPay:
1. Store Settings → Webhooks
2. Click "Create Webhook"
3. Settings:
   - **URL**: `https://yourghost.com/webhooks/btcpay/`
   - **Secret**: (paste from .env BTCPAY_WEBHOOK_SECRET)
   - **Events**: Select all invoice events
   - **Active**: ✅
4. Save

### Step 6: Restart Ghost (2 mins)

```bash
cd /Volumes/Containers/Ghost

# Rebuild
yarn build

# Restart (Docker)
yarn docker:restart

# OR restart (PM2)
pm2 restart ghost

# Monitor logs
yarn docker:logs  # or: pm2 logs ghost
```

### Step 7: Test Payment Flow (20 mins)

#### Test Bitcoin Payment:
1. Create test invoice via BTCPay API (see DEPLOYMENT_GUIDE.md)
2. Pay with testnet Bitcoin (or mainnet if ready)
3. Verify webhook received (check Ghost logs)
4. Verify subscription created:
   ```sql
   SELECT * FROM members_crypto_subscriptions ORDER BY created_at DESC LIMIT 1;
   ```

---

## ✅ Verification Checklist

After setup, verify:

- [ ] BTCPay Server accessible at your domain
- [ ] API token works (test invoice creation)
- [ ] Ghost database has 3 new crypto tables
- [ ] Environment variables configured
- [ ] Webhook endpoint responds to test delivery
- [ ] Test payment creates subscription in database
- [ ] Member status updates to "paid"

---

## 🎨 Update Portal UI (Optional but Recommended)

To add payment method selector to signup page:

1. Edit: `apps/portal/src/components/pages/SignupPage.js`
2. Add payment method selector UI
3. Fetch pricing from `/ghost/api/members/pricing`
4. Show two options:
   - Credit Card ($10/year)
   - Bitcoin ($30/year) - Privacy Premium

See `DEPLOYMENT_GUIDE.md` Phase 6 for code examples.

---

## 📊 Monitor Your First Bitcoin Payment

When someone pays with Bitcoin:

1. **Invoice Created** - Member clicks "Pay with Bitcoin"
2. **Payment Detected** - Bitcoin transaction broadcast
3. **Processing** - Waiting for blockchain confirmation
4. **Settled** - Confirmed! Webhook fires
5. **Subscription Created** - Member gets access

Check Ghost logs:
```bash
yarn docker:logs | grep BTCPay
# or
pm2 logs ghost | grep BTCPay
```

Check database:
```sql
-- View active crypto subscriptions
SELECT 
    cs.id,
    m.email,
    cs.status,
    cs.amount,
    cs.current_period_end
FROM members_crypto_subscriptions cs
JOIN members m ON cs.member_id = m.id
WHERE cs.status = 'active'
ORDER BY cs.created_at DESC;
```

---

## 🚨 Common Issues & Solutions

### Issue: BTCPay Server Won't Start
**Solution**: Check DNS is pointing to server IP, wait for propagation

### Issue: Webhook Not Received
**Solution**: 
1. Verify webhook URL is publicly accessible
2. Check webhook secret matches .env
3. Test delivery manually in BTCPay UI

### Issue: Payment Doesn't Create Subscription
**Solution**:
1. Check Ghost logs for errors
2. Verify member email in invoice metadata
3. Check database migration completed

### Issue: Can't Access BTCPay API
**Solution**:
1. Verify API token is correct
2. Check token permissions include `btcpay.store.*`
3. Test with curl

---

## 📈 Next Steps After Setup

### Week 1
- [ ] Test both payment methods (Stripe + Bitcoin)
- [ ] Monitor webhook delivery success rate
- [ ] Check subscription creation logs
- [ ] Verify member access control works

### Week 2
- [ ] Update Portal UI with payment selector
- [ ] Add analytics tracking for payment methods
- [ ] Document internal procedures
- [ ] Train team on new system

### Month 1
- [ ] Review conversion rates by payment method
- [ ] Analyze revenue: Stripe vs Bitcoin
- [ ] Implement renewal email system
- [ ] Build admin dashboard for crypto subscriptions

---

## 💡 Pro Tips

1. **Start with Testnet**: Use BTCPay testnet mode to test full flow with free testnet Bitcoin
2. **Monitor Closely**: Watch logs for first week to catch any issues early
3. **Backup Seed Phrase**: Store Bitcoin wallet seed phrase in secure offline location
4. **Set Alerts**: Monitor webhook failures and payment anomalies
5. **Document Everything**: Keep notes on your specific configuration

---

## 📚 Full Documentation

Detailed guides available in workspace:

- **`DEPLOYMENT_GUIDE.md`** - Complete deployment walkthrough
- **`BTCPAY_IMPLEMENTATION_GUIDE.md`** - Technical deep-dive
- **`CRYPTO_COMPARISON_SUMMARY.md`** - Full feature overview
- **`CRYPTO_PAYMENT_ALTERNATIVES.md`** - Processor research

---

## 🎯 Success!

Your dual payment system is ready when you can:

✅ Member chooses Stripe → Pays $10/year → Gets access
✅ Member chooses Bitcoin → Pays $30/year → Gets access (no KYC!)

Both paths grant identical access, but Bitcoin subscribers pay a privacy premium and generate 3x more revenue!

---

## 🆘 Need Help?

**BTCPay Support**:
- Docs: https://docs.btcpayserver.org
- Community: https://chat.btcpayserver.org

**Ghost Support**:
- Docs: https://ghost.org/docs/
- Forum: https://forum.ghost.org

**Implementation Files**:
All code is in: `/Volumes/Containers/Ghost/ghost/core/core/server/services/payments/`

---

**Estimated Setup Time**: 2-4 hours from start to first Bitcoin payment! 🚀

Good luck! You're implementing something most publishers won't: true payment privacy and censorship resistance.

