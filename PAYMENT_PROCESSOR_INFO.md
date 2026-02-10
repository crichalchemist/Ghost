# Ghost Payment Processor Documentation

## Primary Payment Processor: **Stripe**

Ghost uses **Stripe** as its primary and only built-in payment processor for handling subscriptions, memberships, and donations.

---

## Stripe Integration Details

### Package Version
- **Stripe SDK**: `stripe@8.222.0` (from `ghost/core/package.json`)
- **Stripe API Version**: `2020-08-27`

### Integration Location
All Stripe integration code is located in:
```
ghost/core/core/server/services/stripe/
├── README.md                    # Documentation of Stripe service
├── stripe-api.js                # Main Stripe API wrapper (~1014 lines)
├── stripe-service.js            # Stripe service implementation
├── webhook-controller.js        # Handles Stripe webhooks
├── webhook-manager.js           # Manages webhook registration
├── billing-portal-manager.js   # Stripe billing portal integration
├── stripe-migrations.js         # Stripe data migrations
├── config.js                    # Stripe configuration
└── services/                    # Additional Stripe services
```

---

## Supported Payment Methods

### Default Payment Methods
- **Credit/Debit Cards** (default, always enabled)

### Additional Payment Methods (Beta Feature)
When the `additionalPaymentMethods` lab flag is enabled, Ghost supports:
- **CashApp Pay**
- **iDEAL** (Netherlands)
- **Bancontact** (Belgium)
- **Other Stripe-supported payment methods**

**To Enable**: Go to Ghost Admin → Settings → Advanced → Labs → Beta Features → "Additional payment methods"

Reference: [Ghost Help - Payment Methods](https://ghost.org/help/payment-methods)

---

## Key Stripe Features

### 1. Checkout Sessions
Ghost creates Stripe Checkout Sessions for:
- **New subscriptions** - Members signing up for paid plans
- **Setup sessions** - Adding/updating payment methods
- **Donations** - One-time donation payments

### 2. Billing Portal
- Stripe Billing Portal integration for members to:
  - Update payment methods
  - Change subscription plans
  - Cancel subscriptions
  - View billing history

### 3. Webhook Events
Ghost listens to these Stripe webhook events:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `checkout.session.completed`

### 4. Rate Limiting
Stripe API calls are rate-limited:
- **Live mode**: 100 requests/second for most APIs
- **Test mode**: 25 requests/second
- **Search API**: 20 requests/second
- **Testing environment**: 10,000 requests/second (to keep tests fast)

---

## Configuration

### Environment Variables
Stripe is configured via the `.env` file:

```bash
# Stripe Secret Key (required)
STRIPE_SECRET_KEY=sk_test_*******

# Stripe Publishable Key (required)
STRIPE_PUBLISHABLE_KEY=pk_test_*******

# Stripe Account ID (optional, for webhooks)
STRIPE_ACCOUNT_ID=acct_1*******
```

### Docker Compose Profile
A dedicated Stripe CLI container is available for local development:

```bash
# Enable Stripe webhook forwarding in development
COMPOSE_PROFILES=stripe yarn dev
```

This starts a Stripe CLI container that forwards webhook events to your local Ghost instance.

---

## Payment Flow

### New Subscription Flow
```
Member → Portal → Ghost → Stripe Checkout
                            ↓
                    Member enters payment details
                            ↓
                    Webhooks to Ghost:
                    1. customer.subscription.created
                    2. checkout.session.completed
                    3. customer.subscription.updated
                    4. invoice.payment_succeeded
                            ↓
                    Ghost creates/updates member subscription
```

### Important Notes
- Webhooks can arrive **out of order**
- Webhooks can be processed **in parallel**
- Operations in Stripe produce **multiple events**
- Ghost handles race conditions gracefully

Reference: [Stripe Webhooks Guide](https://docs.stripe.com/webhooks)

---

## Lab Flags

### `additionalPaymentMethods` (Public Beta)
- **Status**: Public Beta Feature
- **Location**: `ghost/core/core/shared/labs.js`
- **Purpose**: Enables additional Stripe payment methods beyond credit cards
- **Default**: Disabled (cards only)

When enabled:
- `payment_method_types` is set to `undefined` (allows all Stripe-supported methods)
- `currency` parameter is passed to checkout sessions
- Supports dynamic payment methods based on customer location

When disabled:
- `payment_method_types` is set to `['card']`
- Only credit/debit cards are accepted

---

## Testing

### Unit Tests
Located in: `ghost/core/test/unit/server/services/stripe/`

### Integration Tests
The Stripe integration is tested in:
- E2E tests in `e2e/`
- Integration tests in `ghost/core/test/integration/`

### Docker Testing
```bash
# Run Stripe-related tests in Docker
yarn docker:test:unit

# Run E2E tests with Stripe
yarn test:e2e
```

---

## Alternative Payment Processors

### Currently Supported
**None.** Ghost **only** supports Stripe natively.

### Custom Integrations
Ghost does not have built-in support for:
- PayPal
- Square
- Braintree
- Adyen
- Other payment processors

To integrate other payment processors, you would need to:
1. Build a custom integration via Ghost's API
2. Use webhooks to sync membership status
3. Implement custom checkout flows

---

## Key Insights

### Architecture
- **Functional design**: Stripe API wrapper with clear separation of concerns
- **Rate limiting**: Built-in throttling to respect Stripe API limits
- **Error handling**: Comprehensive error handling with specific error types
- **Webhook resilience**: Handles out-of-order and parallel webhook events

### Configuration
- Single configuration point via `stripe-api.js`
- Environment-based settings (test vs live mode)
- Lab flags for feature gating

### Extensibility
- The `additionalPaymentMethods` flag shows Ghost's approach to adding payment method support
- Stripe's dynamic payment methods feature is leveraged rather than hard-coding each type

---

## Resources

### Internal Documentation
- `ghost/core/core/server/services/stripe/README.md` - Detailed Stripe service docs
- `AGENTS.md` - AI agent guidance for working with Ghost
- `CLAUDE.md` - Development workflow and commands

### External Resources
- [Ghost Help - Payment Methods](https://ghost.org/help/payment-methods)
- [Stripe Webhooks Guide](https://docs.stripe.com/webhooks)
- [Stripe API Documentation](https://docs.stripe.com/api)
- [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions)

---

## Summary

✅ **Payment Processor**: Stripe (only)  
✅ **Default Methods**: Credit/Debit Cards  
✅ **Additional Methods**: CashApp, iDEAL, Bancontact, etc. (beta flag)  
✅ **Integration**: Native, deeply integrated  
✅ **Configuration**: Environment variables via `.env`  
✅ **Development**: Docker Compose profile available  
✅ **Architecture**: Functional, rate-limited, webhook-resilient  

**No other payment processors are supported natively.**

