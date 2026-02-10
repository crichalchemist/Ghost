# Dual Payment System: Stripe + BTCPay Integration

**Strategy**: Keep Stripe for traditional payments, add BTCPay for Bitcoin
**Pricing**: $10/year (Stripe) | $30/year (Bitcoin)

---

## Pricing Rationale

**Why charge more for Bitcoin?**
1. **No payment processor fees** - You save 2.9% + $0.30 on Stripe
2. **Privacy premium** - Users paying for anonymity/KYC-free payments
3. **Bitcoin volatility buffer** - Extra margin covers price fluctuations
4. **Self-hosting costs** - BTCPay infrastructure and maintenance
5. **Market positioning** - Premium for censorship-resistant payments

**Math**:
- Stripe: $10/year - 2.9% = $9.71 revenue (+ $0.30 fee = net ~$9.41)
- Bitcoin: $30/year - network fees (~$2-5) = $25-28 revenue
- Bitcoin profit: +166% more per subscriber

---

## Implementation Phases

### Phase 1: BTCPay Server Setup ✅
### Phase 2: Database Schema (NEW TABLES)
### Phase 3: Payment Provider Abstraction
### Phase 4: BTCPay Service Integration
### Phase 5: Pricing Configuration
### Phase 6: Portal UI Updates (Dual Payment Option)
### Phase 7: Admin Dashboard Updates
### Phase 8: Testing & Deployment

---

## Immediate Action Items

1. ✅ Document created
2. ⏭️ Create database migrations
3. ⏭️ Build payment abstraction layer
4. ⏭️ Implement BTCPay service
5. ⏭️ Add dual pricing configuration
6. ⏭️ Update Portal UI for payment method selection
7. ⏭️ Deploy BTCPay Server

---

## File Structure

```
ghost/core/core/server/services/
├── stripe/                        # Keep existing Stripe service
│   └── [unchanged]
├── payments/                      # NEW: Payment abstraction layer
│   ├── index.js                  # Payment service factory
│   ├── payment-provider.js       # Abstract interface
│   ├── stripe-provider.js        # Stripe implementation
│   ├── btcpay-provider.js        # BTCPay implementation
│   ├── subscription-manager.js   # Unified subscription logic
│   └── pricing-config.js         # Dual pricing configuration
├── btcpay/                        # NEW: BTCPay service
│   ├── btcpay-api.js             # API wrapper
│   ├── btcpay-service.js         # Main service
│   ├── webhook-controller.js     # Webhook handler
│   └── config.js                 # BTCPay configuration
```

---

## Next Steps

Run:
```bash
# 1. Review database migrations
cat ghost/core/core/server/data/migrations/versions/6.0/2026-02-10-add-crypto-payments.js

# 2. Run migrations
yarn knex-migrator migrate

# 3. Configure pricing
# Edit: ghost/core/core/server/services/payments/pricing-config.js

# 4. Deploy BTCPay Server
# See BTCPAY_IMPLEMENTATION_GUIDE.md
```

---

## Configuration Preview

```javascript
// Dual pricing configuration
const PRICING = {
  annual_membership: {
    stripe: {
      price_id: 'price_stripe_annual_10',
      amount: 1000,        // $10.00 in cents
      currency: 'usd',
      interval: 'year'
    },
    btcpay: {
      price_id: 'btc_annual_30',
      amount: 3000,        // $30.00 in cents
      currency: 'usd',
      interval: 'year',
      display_note: 'Privacy premium - no KYC required'
    }
  }
};
```

