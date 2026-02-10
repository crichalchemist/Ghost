# Crypto Payment Processor Alternatives for Ghost

**Date**: February 9, 2026  
**Current Processor**: Stripe (KYC required, fiat-only)

---

## Executive Summary

Yes, there are several crypto payment processors that accept cryptocurrency without requiring extensive KYC/identifying information. However, **replacing Stripe in Ghost requires significant development work** as Ghost's entire membership and subscription system is deeply integrated with Stripe's API.

---

## Privacy-Focused Crypto Payment Processors

### 1. **BTCPay Server** ⭐ RECOMMENDED
**Privacy Level**: ★★★★★ (Highest)

**Features**:
- ✅ **Self-hosted** - Complete control, no third party
- ✅ **No KYC** - Zero identifying information required
- ✅ **Zero fees** - Only network transaction fees
- ✅ **Non-custodial** - You control the private keys
- ✅ **Open source** - Fully auditable code
- ✅ **Supports**: Bitcoin, Lightning Network, altcoins via plugins

**Cryptocurrencies**:
- Bitcoin (BTC)
- Lightning Network (instant, low-fee BTC)
- Litecoin, Monero, Dash (via plugins)

**Integration Method**:
- RESTful API
- Webhooks for payment notifications
- Greenfield API (modern, well-documented)

**KYC Requirements**: **NONE** - Completely anonymous

**Ideal For**: Maximum privacy, self-sovereignty, avoiding third-party dependencies

**Hosting Options**:
- Self-hosted (Docker, VPS, dedicated server)
- LunaNode web deployment (simplified)
- Voltage Cloud (managed BTCPay hosting)

**Resources**:
- Website: https://btcpayserver.org
- API Docs: https://docs.btcpayserver.org/API/Greenfield/v1/
- GitHub: https://github.com/btcpayserver/btcpayserver

---

### 2. **NOWPayments**
**Privacy Level**: ★★★☆☆ (Moderate)

**Features**:
- ✅ **Low KYC** - Minimal info for small volumes (<€1000/month)
- ✅ **API integration** - Similar to Stripe
- ✅ **Auto-conversion** - Convert crypto to fiat (optional)
- ✅ **100+ cryptocurrencies**
- ⚠️ **Third-party custody** during processing

**KYC Requirements**: 
- **Basic tier**: Email only (up to €1000/month)
- **Higher volumes**: KYC required (business info, ID)

**Fees**: 0.5% - 1% per transaction

**Cryptocurrencies**:
- Bitcoin, Ethereum, Litecoin
- Privacy coins: Monero (XMR), Zcash (ZEC)
- Stablecoins: USDT, USDC, DAI
- 100+ altcoins

**Resources**:
- Website: https://nowpayments.io
- API Docs: https://documenter.getpostman.com/view/7907941/S1a32n38

---

### 3. **CoinGate**
**Privacy Level**: ★★☆☆☆ (Low-Moderate)

**Features**:
- ✅ **70+ cryptocurrencies**
- ✅ **Recurring billing support**
- ✅ **Auto-conversion to fiat**
- ⚠️ **KYC required** for business accounts

**KYC Requirements**: 
- Business verification required
- ID and proof of address

**Fees**: 1% per transaction

**Cryptocurrencies**:
- Bitcoin, Ethereum, Litecoin
- Stablecoins
- 70+ altcoins

**Resources**:
- Website: https://coingate.com
- API Docs: https://developer.coingate.com/docs

---

### 4. **OpenNode**
**Privacy Level**: ★★★☆☆ (Moderate)

**Features**:
- ✅ **Bitcoin & Lightning Network focus**
- ✅ **Instant settlements**
- ✅ **Subscription support** (recurring payments)
- ✅ **Clean API**
- ⚠️ **KYC for business accounts**

**KYC Requirements**: 
- Light KYC for personal use
- Full KYC for business accounts

**Fees**: 1% per transaction

**Cryptocurrencies**:
- Bitcoin (BTC)
- Lightning Network

**Resources**:
- Website: https://www.opennode.com
- API Docs: https://developers.opennode.com

---

### 5. **Coinbase Commerce** (Deprecated as of 2025)
**Note**: Coinbase Commerce was discontinued in 2025. Listed for historical reference only.

---

### 6. **Monero Payment Processors**

#### **Monero Gateway for WooCommerce** (adaptable)
**Privacy Level**: ★★★★★ (Highest)

**Features**:
- ✅ **True privacy** - Monero is privacy-by-default
- ✅ **Self-hosted** verification
- ✅ **No KYC**
- ✅ **Open source**

**Limitations**:
- Currently WooCommerce-specific
- Would require custom integration for Ghost

**Resources**:
- GitHub: https://github.com/monero-integrations/monerowp

---

## Comparison Matrix

| Processor | KYC Required | Privacy Level | Cryptocurrencies | Self-Hosted | Recurring Payments | Fees |
|-----------|-------------|---------------|------------------|-------------|-------------------|------|
| **BTCPay Server** | ❌ None | ⭐⭐⭐⭐⭐ | BTC, Lightning, +plugins | ✅ Yes | ✅ Yes* | Network fees only |
| **NOWPayments** | ⚠️ Minimal/Yes | ⭐⭐⭐ | 100+ | ❌ No | ❌ No | 0.5-1% |
| **CoinGate** | ✅ Yes | ⭐⭐ | 70+ | ❌ No | ✅ Yes | 1% |
| **OpenNode** | ✅ Yes | ⭐⭐⭐ | BTC, Lightning | ❌ No | ✅ Yes | 1% |
| **Stripe** (current) | ✅ Yes | ⭐ | Fiat only | ❌ No | ✅ Yes | 2.9% + $0.30 |

*BTCPay Server supports recurring payments via invoicing, but requires custom implementation

---

## Technical Integration Challenges

### Ghost's Stripe Dependencies

Ghost's membership system is **deeply coupled** with Stripe:

1. **Subscription Management**
   - Stripe webhook events drive member status
   - Subscription lifecycle (create, update, cancel) is Stripe-specific
   - Trial periods, offers, and coupons use Stripe APIs

2. **Payment Methods**
   - Credit card tokenization via Stripe.js
   - Payment method storage and management
   - Customer portal for self-service

3. **Billing Portal**
   - Update payment methods
   - Change plans
   - View invoices
   - Cancel subscriptions

4. **Database Schema**
   - `members_stripe_customers` table
   - `members_stripe_customers_subscriptions` table
   - Stripe customer IDs, subscription IDs stored throughout

5. **Core Services**
   - `ghost/core/core/server/services/stripe/` (~10+ files, 5000+ lines)
   - Webhook handling system
   - Rate limiting
   - Error handling

### Required Development Work

To replace Stripe with a crypto payment processor:

#### **Minimal Integration** (Simple payments, no subscriptions)
- **Effort**: 40-80 hours
- Create new payment service (e.g., `btcpay-service.js`)
- Implement webhook handlers
- Update member creation flow
- Add crypto payment UI components
- **Limitation**: One-time payments only, no recurring subscriptions

#### **Full Integration** (Subscriptions + memberships)
- **Effort**: 200-400 hours
- Abstract payment provider interface
- Implement subscription lifecycle management
- Create custom billing portal
- Database schema modifications
- Migrate existing Stripe data
- Testing and QA
- **Result**: Full feature parity with Stripe

---

## Recommended Approach

### Option 1: **BTCPay Server + Custom Integration** ⭐ BEST FOR PRIVACY

**Pros**:
- ✅ Zero KYC, maximum privacy
- ✅ Self-hosted, no third party
- ✅ Zero fees (only network costs)
- ✅ Complete control
- ✅ Open source, auditable

**Cons**:
- ⚠️ Requires self-hosting infrastructure
- ⚠️ No native recurring payment support
- ⚠️ Significant development work for Ghost integration
- ⚠️ Requires crypto expertise to maintain

**Best For**: 
- Privacy-focused publications
- Technical teams comfortable with self-hosting
- Organizations wanting zero third-party dependencies

**Implementation Path**:
1. Deploy BTCPay Server (Docker recommended)
2. Create Ghost payment service adapter
3. Implement webhook handlers
4. Build subscription management layer
5. Create crypto payment UI in Portal app

---

### Option 2: **NOWPayments + Limited KYC**

**Pros**:
- ✅ Minimal KYC for small volumes
- ✅ Simple API integration
- ✅ 100+ cryptocurrencies
- ✅ Includes privacy coins (Monero, Zcash)

**Cons**:
- ⚠️ Third-party custody during processing
- ⚠️ KYC required for higher volumes
- ⚠️ No native recurring billing
- ⚠️ Still requires Ghost integration work

**Best For**:
- Quick crypto payment addition
- Lower technical expertise
- Willing to use third-party service

---

### Option 3: **Dual Payment System** (Keep Stripe + Add Crypto)

**Approach**: Run both Stripe AND crypto processor simultaneously

**Pros**:
- ✅ No disruption to existing members
- ✅ Offer choice to new members
- ✅ Gradual transition possible
- ✅ Maintains Stripe features while adding crypto option

**Cons**:
- ⚠️ More complex codebase
- ⚠️ Two payment systems to maintain
- ⚠️ UI complexity (choosing payment method)

**Best For**:
- Organizations wanting to offer both options
- Risk mitigation during transition
- Testing crypto payments before full switch

---

## Code Structure for BTCPay Integration

### High-Level Architecture

```
ghost/core/core/server/services/
├── stripe/                    # Existing Stripe service
│   └── [current implementation]
├── btcpay/                    # New BTCPay service
│   ├── btcpay-api.js         # BTCPay Greenfield API wrapper
│   ├── btcpay-service.js     # Main service class
│   ├── webhook-controller.js # Webhook event handler
│   ├── subscription-manager.js # Custom subscription logic
│   └── config.js             # BTCPay configuration
└── payments/                  # New payment abstraction layer
    ├── payment-provider-interface.js
    ├── stripe-provider.js    # Stripe implementation
    └── btcpay-provider.js    # BTCPay implementation
```

### Key Implementation Files Needed

1. **BTCPay API Wrapper** (`btcpay-api.js`)
   - Create invoices
   - Check payment status
   - Webhook signature verification
   - Store management

2. **Subscription Manager** (`subscription-manager.js`)
   - Track subscription state in Ghost DB
   - Handle renewal invoices
   - Manage access control
   - Send payment reminders

3. **Webhook Handler** (`webhook-controller.js`)
   - `InvoiceCreated`
   - `InvoiceProcessing`
   - `InvoiceSettled` (payment confirmed)
   - `InvoiceExpired`

4. **Member Integration**
   - Update member repository
   - Add crypto payment methods
   - Track Bitcoin addresses/invoices

---

## Database Schema Changes

### New Tables Required

```sql
-- Track crypto payment providers
CREATE TABLE members_crypto_providers (
    id VARCHAR(24) PRIMARY KEY,
    member_id VARCHAR(24) NOT NULL,
    provider VARCHAR(50) NOT NULL, -- 'btcpay', 'nowpayments', etc.
    customer_id VARCHAR(255), -- Provider's customer ID
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Track crypto subscriptions
CREATE TABLE members_crypto_subscriptions (
    id VARCHAR(24) PRIMARY KEY,
    member_id VARCHAR(24) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    subscription_id VARCHAR(255),
    plan_id VARCHAR(255),
    status VARCHAR(50), -- 'active', 'past_due', 'canceled', etc.
    current_period_end DATETIME,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Track individual crypto invoices
CREATE TABLE members_crypto_invoices (
    id VARCHAR(24) PRIMARY KEY,
    subscription_id VARCHAR(24),
    invoice_id VARCHAR(255),
    amount_crypto VARCHAR(50), -- e.g., '0.00123 BTC'
    amount_fiat INTEGER, -- in cents
    currency VARCHAR(10),
    status VARCHAR(50),
    paid_at DATETIME,
    created_at DATETIME,
    FOREIGN KEY (subscription_id) REFERENCES members_crypto_subscriptions(id)
);
```

---

## Security Considerations

### For BTCPay Server

1. **Infrastructure Security**
   - Run BTCPay in isolated environment
   - Use hardware wallets for production keys
   - Regular security updates
   - SSL/TLS for all communications

2. **Webhook Validation**
   - Verify webhook signatures
   - Use HMAC authentication
   - IP whitelist if possible

3. **Access Control**
   - Separate API keys for different operations
   - Read-only keys where possible
   - Key rotation policy

### For Third-Party Providers

1. **API Key Management**
   - Store keys in environment variables
   - Never commit keys to repository
   - Use Ghost's secrets management

2. **Data Privacy**
   - Minimize data sent to provider
   - Don't send unnecessary member info
   - GDPR compliance considerations

---

## Estimated Costs

### BTCPay Server (Self-Hosted)

**Infrastructure**:
- VPS (4GB RAM, 80GB SSD): $20-40/month
- Domain + SSL: $15/year
- **Total**: ~$25-45/month + setup time

**Transaction Costs**:
- Bitcoin network fees: Variable ($0.50 - $5 per transaction in 2026)
- Lightning Network: <$0.01 per transaction
- No percentage fees

**Annual Cost Example** (1000 members × $10/month):
- Infrastructure: $300-540/year
- Transaction fees: ~$600-6000/year (depends on network congestion)
- **Total**: ~$900-6,540/year

**vs Stripe**: $3,480/year in fees alone (2.9% × $120,000)

### NOWPayments

**Fees**: 0.5-1% per transaction
- **Annual Cost Example**: $600-1,200/year (1% × $120,000)
- No infrastructure costs
- **Total**: ~$600-1,200/year

---

## Legal & Regulatory Considerations

### Crypto Payment Acceptance

1. **Tax Implications**
   - Crypto payments may trigger capital gains tax events
   - Recordkeeping requirements vary by jurisdiction
   - Consult tax professional for your location

2. **AML/KYC Regulations**
   - BTCPay: No KYC required (you're the merchant)
   - Third-party processors: May require KYC at certain thresholds
   - Regulations vary by country

3. **Business Registration**
   - Some jurisdictions require specific licenses for crypto businesses
   - Check local regulations

4. **Volatility Risk**
   - Crypto prices fluctuate
   - Consider instant conversion to stablecoins
   - Or accept volatility as part of business model

---

## Recommended Implementation Roadmap

### Phase 1: Research & Planning (2-4 weeks)
- [ ] Choose crypto payment processor
- [ ] Deploy test BTCPay instance (if chosen)
- [ ] Review Ghost payment architecture
- [ ] Design database schema changes
- [ ] Create technical specification document

### Phase 2: Core Integration (8-12 weeks)
- [ ] Create payment provider abstraction layer
- [ ] Implement BTCPay/crypto service
- [ ] Build webhook handlers
- [ ] Database migrations
- [ ] Update member repository

### Phase 3: UI/UX Development (4-6 weeks)
- [ ] Update Portal app with crypto payment option
- [ ] Create crypto checkout flow
- [ ] Build member crypto billing page
- [ ] Add admin dashboard for crypto payments

### Phase 4: Testing (4-6 weeks)
- [ ] Unit tests for crypto service
- [ ] Integration tests
- [ ] End-to-end payment flows
- [ ] Security audit
- [ ] Load testing

### Phase 5: Deployment (2-3 weeks)
- [ ] Staging environment testing
- [ ] Production deployment
- [ ] Monitor initial transactions
- [ ] User documentation

**Total Timeline**: 20-31 weeks (5-8 months)

---

## Conclusion

**Yes, crypto processors without KYC exist and can replace Stripe**, but the integration is non-trivial.

### Best Option for Privacy + Control
**BTCPay Server** - Zero KYC, self-hosted, maximum privacy, but requires significant development.

### Easiest Option
**NOWPayments** - Minimal KYC for small volumes, simpler integration, but third-party dependency.

### Pragmatic Approach
**Dual system** - Keep Stripe for existing members, add BTCPay for privacy-focused users.

---

## Next Steps

1. **Decide on priority**: Privacy vs. ease of implementation vs. timeline
2. **Choose processor**: BTCPay (privacy) vs. NOWPayments (simplicity)
3. **Assess resources**: Development time, infrastructure, maintenance
4. **Start small**: Test integration with limited feature set
5. **Iterate**: Add features based on user feedback

---

## Resources for Implementation

### BTCPay Server
- Official Docs: https://docs.btcpayserver.org
- Greenfield API: https://docs.btcpayserver.org/API/Greenfield/v1/
- Community: https://chat.btcpayserver.org
- GitHub: https://github.com/btcpayserver

### General Crypto Integration
- Web3.js: https://web3js.readthedocs.io
- Lightning Network: https://lightning.network
- Cryptocurrency payment best practices: https://bitcoin.org/en/developer-guide

### Ghost Development
- Ghost API Documentation: https://ghost.org/docs/api/
- Contributing Guide: `.github/CONTRIBUTING.md`
- Architecture decisions: `adr/` directory

---

**Questions to Consider**:
1. What percentage of your audience would use crypto payments?
2. Can you maintain BTCPay infrastructure or prefer managed solution?
3. What's your timeline for implementation?
4. What's your budget for development?
5. Do you need recurring subscriptions or one-time payments?


