# PrivateStack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a privacy-first Ghost hosting platform with dual Bitcoin/Stripe payments at two tiers (creator hosting + subscriber subscriptions)

**Architecture:** Two-tier system where creators pay for Ghost hosting (Tier 1: Portal + Docker containers) and their subscribers pay creators for content (Tier 2: Modified Ghost with BTCPay + Stripe). Minimal data collection with anonymous Bitcoin option using bearer tokens.

**Tech Stack:** Ghost CMS (Node.js), BTCPay Server, Stripe API, Express.js, React, SQLite, Docker, Caddy

**Related Design:** `docs/plans/2026-02-10-privatestack-design.md`

---

## Implementation Phases

This plan covers **Phase 1: Complete Subscriber Payment System (Tier 2)** - finishing the dual payment foundation that's already partially built.

**Future phases** (not in this plan):
- Phase 2: Build Hosting Platform Portal (Tier 1)
- Phase 3: Container Orchestration
- Phase 4: Integration & Testing

---

## Task 1: Add Access Token Column for Anonymous Bitcoin Subscriptions

**Goal:** Enable anonymous Bitcoin subscribers to access content via bearer token URLs without providing email

**Files:**
- Create: `ghost/core/core/server/data/migrations/versions/6.0/2026-02-10-add-access-token-to-crypto-subscriptions.js`
- Reference: `ghost/core/core/server/data/migrations/versions/6.0/2026-02-10-add-crypto-payments.js` (existing)

---

**Step 1: Write the migration file**

Create: `ghost/core/core/server/data/migrations/versions/6.0/2026-02-10-add-access-token-to-crypto-subscriptions.js`

```javascript
const {addColumn} = require('../../../schema/commands');

module.exports = {
    config: {
        transaction: true
    },

    async up({connection}) {
        const hasColumn = await connection.schema.hasColumn('members_crypto_subscriptions', 'access_token');

        if (!hasColumn) {
            await addColumn('members_crypto_subscriptions', 'access_token', {
                type: 'string',
                maxlength: 64,
                nullable: true,
                unique: true
            }, connection);
        }
    },

    async down({connection}) {
        const hasColumn = await connection.schema.hasColumn('members_crypto_subscriptions', 'access_token');

        if (hasColumn) {
            await connection.schema.table('members_crypto_subscriptions', (table) => {
                table.dropColumn('access_token');
            });
        }
    }
};
```

**Step 2: Test migration locally**

Run: `yarn knex-migrator migrate --mgpath ghost/core/core/server/data/migrations`
Expected: Migration runs successfully, column added

**Step 3: Verify column exists**

Run: `sqlite3 ghost/core/.ghost/data/ghost-local.db "PRAGMA table_info(members_crypto_subscriptions);"`
Expected: See `access_token` column in output

**Step 4: Commit**

```bash
git add ghost/core/core/server/data/migrations/versions/6.0/2026-02-10-add-access-token-to-crypto-subscriptions.js
git commit -m "feat(payments): add access_token column for anonymous Bitcoin subscriptions"
```

---

## Task 2: Generate Bearer Tokens for Anonymous Subscriptions

**Goal:** Generate cryptographically secure bearer tokens when Bitcoin subscribers opt out of providing email

**Files:**
- Modify: `ghost/core/core/server/services/payments/btcpay-webhook-controller.js:90-120` (handleInvoiceSettled method)

---

**Step 1: Write test for bearer token generation**

Create: `ghost/core/test/unit/server/services/payments/btcpay-webhook-controller.test.js`

```javascript
const should = require('should');
const sinon = require('sinon');
const BTCPayWebhookController = require('../../../../../core/server/services/payments/btcpay-webhook-controller');

describe('BTCPayWebhookController', function () {
    let controller;
    let cryptoSubscriptionModel;
    let memberModel;

    beforeEach(function () {
        cryptoSubscriptionModel = {
            add: sinon.stub().resolves({id: 'sub_123'})
        };
        memberModel = {
            add: sinon.stub().resolves({id: 'mem_123', email: null}),
            findOne: sinon.stub().resolves(null)
        };
        controller = new BTCPayWebhookController({
            cryptoSubscriptionModel,
            memberModel
        });
    });

    describe('handleInvoiceSettled - Anonymous Subscription', function () {
        it('should generate 64-character bearer token when email is not provided', async function () {
            const event = {
                invoiceId: 'inv_123',
                metadata: {
                    memberEmail: null,
                    tier: 'annual'
                }
            };

            const subscription = await controller.handleInvoiceSettled(event);

            should.exist(subscription.access_token);
            subscription.access_token.should.have.length(64);
            subscription.access_token.should.match(/^[a-f0-9]{64}$/);
        });

        it('should not generate bearer token when email is provided', async function () {
            memberModel.findOne.resolves({id: 'mem_123', email: 'user@example.com'});

            const event = {
                invoiceId: 'inv_123',
                metadata: {
                    memberEmail: 'user@example.com',
                    tier: 'annual'
                }
            };

            const subscription = await controller.handleInvoiceSettled(event);

            should.not.exist(subscription.access_token);
        });
    });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test:unit ghost/core/test/unit/server/services/payments/btcpay-webhook-controller.test.js`
Expected: FAIL - handleInvoiceSettled not implemented yet

**Step 3: Implement bearer token generation**

Modify: `ghost/core/core/server/services/payments/btcpay-webhook-controller.js`

Add at top:
```javascript
const crypto = require('crypto');
```

Update handleInvoiceSettled method (around line 90):
```javascript
async handleInvoiceSettled(event) {
    const {invoiceId, metadata} = event;
    const {memberEmail, tier} = metadata;

    // Find or create member
    let member;
    if (memberEmail) {
        member = await this.memberModel.findOne({email: memberEmail});
        if (!member) {
            member = await this.memberModel.add({
                email: memberEmail,
                status: 'paid'
            });
        }
    } else {
        // Anonymous subscription - no email
        member = await this.memberModel.add({
            email: null,
            status: 'paid'
        });
    }

    // Generate access token for anonymous subscriptions
    const accessToken = memberEmail ? null : crypto.randomBytes(32).toString('hex');

    // Create subscription record
    const subscription = await this.cryptoSubscriptionModel.add({
        member_id: member.id,
        invoice_id: invoiceId,
        tier: tier,
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        access_token: accessToken
    });

    return subscription;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test:unit ghost/core/test/unit/server/services/payments/btcpay-webhook-controller.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add ghost/core/core/server/services/payments/btcpay-webhook-controller.js ghost/core/test/unit/server/services/payments/btcpay-webhook-controller.test.js
git commit -m "feat(payments): generate bearer tokens for anonymous Bitcoin subscriptions"
```

---

## Task 3: Create Bearer Token Access Route

**Goal:** Allow anonymous subscribers to access content by visiting `/access/:token` URL

**Files:**
- Create: `ghost/core/core/server/web/api/endpoints/members/access-token-auth.js`
- Modify: `ghost/core/core/server/web/api/endpoints/members/routes.js`

---

**Step 1: Write test for token authentication**

Create: `ghost/core/test/unit/server/web/api/endpoints/members/access-token-auth.test.js`

```javascript
const should = require('should');
const sinon = require('sinon');
const accessTokenAuth = require('../../../../../core/server/web/api/endpoints/members/access-token-auth');

describe('Access Token Authentication', function () {
    let req, res, next;
    let cryptoSubscriptionModel;

    beforeEach(function () {
        req = {
            params: {token: 'abc123def456'},
            session: {}
        };
        res = {
            cookie: sinon.stub(),
            redirect: sinon.stub()
        };
        next = sinon.stub();

        cryptoSubscriptionModel = {
            findOne: sinon.stub()
        };
    });

    it('should authenticate valid token and set cookie', async function () {
        cryptoSubscriptionModel.findOne.resolves({
            id: 'sub_123',
            member_id: 'mem_123',
            status: 'active',
            access_token: 'abc123def456'
        });

        await accessTokenAuth.authenticate(req, res, next, cryptoSubscriptionModel);

        res.cookie.calledOnce.should.be.true();
        res.cookie.firstCall.args[0].should.equal('ghost-members-ssr');
        res.redirect.calledWith('/').should.be.true();
    });

    it('should reject invalid token', async function () {
        cryptoSubscriptionModel.findOne.resolves(null);

        await accessTokenAuth.authenticate(req, res, next, cryptoSubscriptionModel);

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
        next.firstCall.args[0].should.be.an.Error();
    });

    it('should reject expired subscription', async function () {
        cryptoSubscriptionModel.findOne.resolves({
            id: 'sub_123',
            member_id: 'mem_123',
            status: 'canceled',
            access_token: 'abc123def456'
        });

        await accessTokenAuth.authenticate(req, res, next, cryptoSubscriptionModel);

        res.cookie.called.should.be.false();
        next.calledOnce.should.be.true();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test:unit ghost/core/test/unit/server/web/api/endpoints/members/access-token-auth.test.js`
Expected: FAIL - module not found

**Step 3: Implement access token authentication**

Create: `ghost/core/core/server/web/api/endpoints/members/access-token-auth.js`

```javascript
const errors = require('@tryghost/errors');
const tpl = require('@tryghost/tpl');

const messages = {
    invalidToken: 'Invalid or expired access token',
    expiredSubscription: 'This subscription has expired'
};

async function authenticate(req, res, next, cryptoSubscriptionModel) {
    const {token} = req.params;

    if (!token || token.length !== 64) {
        return next(new errors.UnauthorizedError({
            message: tpl(messages.invalidToken)
        }));
    }

    try {
        // Find subscription by access token
        const subscription = await cryptoSubscriptionModel.findOne({
            access_token: token
        }, {withRelated: ['member']});

        if (!subscription) {
            return next(new errors.UnauthorizedError({
                message: tpl(messages.invalidToken)
            }));
        }

        // Check subscription is active
        if (subscription.get('status') !== 'active') {
            return next(new errors.UnauthorizedError({
                message: tpl(messages.expiredSubscription)
            }));
        }

        // Set authentication cookie
        const member = subscription.related('member');
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
        };

        res.cookie('ghost-members-ssr', JSON.stringify({
            memberId: member.id,
            accessType: 'bearer-token'
        }), cookieOptions);

        // Redirect to homepage
        res.redirect('/');
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    authenticate
};
```

**Step 4: Add route to members router**

Modify: `ghost/core/core/server/web/api/endpoints/members/routes.js`

Add near the top:
```javascript
const accessTokenAuth = require('./access-token-auth');
```

Add route (after other routes):
```javascript
router.get('/access/:token',
    async (req, res, next) => {
        const models = require('../../../../models');
        await accessTokenAuth.authenticate(
            req,
            res,
            next,
            models.MembersCryptoSubscription
        );
    }
);
```

**Step 5: Run test to verify it passes**

Run: `yarn test:unit ghost/core/test/unit/server/web/api/endpoints/members/access-token-auth.test.js`
Expected: PASS

**Step 6: Test route manually**

Run: `yarn dev`
Visit: `http://localhost:2368/access/invalidtoken123`
Expected: Error message displayed

**Step 7: Commit**

```bash
git add ghost/core/core/server/web/api/endpoints/members/access-token-auth.js ghost/core/core/server/web/api/endpoints/members/routes.js ghost/core/test/unit/server/web/api/endpoints/members/access-token-auth.test.js
git commit -m "feat(members): add bearer token access route for anonymous subscribers"
```

---

## Task 4: Minimize Stripe Data Collection in Portal

**Goal:** Remove name and full address fields from Stripe signup, keep only email + ZIP

**Files:**
- Modify: `apps/portal/src/components/pages/SignupPage.js:45-120`

---

**Step 1: Locate current Stripe form fields**

Read: `apps/portal/src/components/pages/SignupPage.js`
Identify: Form fields for name, email, address, ZIP

**Step 2: Remove unnecessary fields**

Modify: `apps/portal/src/components/pages/SignupPage.js`

Find the form rendering section (around line 60-90) and update:

```javascript
// Before: Multiple form fields
<input type="text" name="name" placeholder="Full Name" />
<input type="email" name="email" placeholder="Email Address" />
<input type="text" name="address_line1" placeholder="Address Line 1" />
<input type="text" name="address_line2" placeholder="Address Line 2" />
<input type="text" name="city" placeholder="City" />
<input type="text" name="state" placeholder="State" />
<input type="text" name="postal_code" placeholder="ZIP Code" />

// After: Minimal fields only
<input type="email" name="email" placeholder="Email Address" required />
<input type="text" name="postal_code" placeholder="ZIP Code" required pattern="[0-9]{5}" />
```

**Step 3: Update Stripe checkout session creation**

Modify: `apps/portal/src/components/pages/SignupPage.js`

Find createCheckoutSession function (around line 120):

```javascript
async function createCheckoutSession() {
    const response = await fetch('/members/api/stripe/checkout', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: formData.email,
            postal_code: formData.postal_code,
            // Remove: name, address fields
            billing_address_collection: 'required', // Change to 'required' for ZIP only
            plan: 'annual'
        })
    });

    const {url} = await response.json();
    window.location.href = url;
}
```

**Step 4: Test form locally**

Run: `cd apps/portal && yarn dev`
Visit: `http://localhost:3000/signup`
Expected: Only email + ZIP fields visible

**Step 5: Commit**

```bash
git add apps/portal/src/components/pages/SignupPage.js
git commit -m "feat(portal): minimize Stripe data collection to email + ZIP only"
```

---

## Task 5: Add Email Optional UI for Bitcoin Checkout

**Goal:** Show optional email field for Bitcoin payments with explanation

**Files:**
- Modify: `apps/portal/src/components/pages/SignupPage.js:130-180`

---

**Step 1: Add Bitcoin payment option UI**

Modify: `apps/portal/src/components/pages/SignupPage.js`

Add payment method selector:

```javascript
function PaymentMethodSelector({selected, onSelect}) {
    return (
        <div className="payment-methods">
            <div
                className={`payment-option ${selected === 'stripe' ? 'selected' : ''}`}
                onClick={() => onSelect('stripe')}
            >
                <h3>Credit Card - $10/year</h3>
                <p>Quick and easy, powered by Stripe</p>
            </div>

            <div
                className={`payment-option ${selected === 'bitcoin' ? 'selected' : ''}`}
                onClick={() => onSelect('bitcoin')}
            >
                <h3>Bitcoin/Lightning - $30/year</h3>
                <p>Private, no personal info required</p>
            </div>
        </div>
    );
}
```

**Step 2: Add optional email checkbox for Bitcoin**

Add conditional email field:

```javascript
{paymentMethod === 'bitcoin' && (
    <div className="email-optional">
        <label>
            <input
                type="checkbox"
                checked={provideEmail}
                onChange={(e) => setProvideEmail(e.target.checked)}
            />
            Provide email for renewal reminders (optional)
        </label>

        {provideEmail && (
            <input
                type="email"
                name="email"
                placeholder="Email Address (optional)"
            />
        )}

        {!provideEmail && (
            <div className="warning">
                <p>⚠️ Without email, you'll receive a bookmark-only access link.</p>
                <p>Save this link carefully - it cannot be recovered!</p>
            </div>
        )}
    </div>
)}
```

**Step 3: Update Bitcoin checkout function**

Add Bitcoin checkout handler:

```javascript
async function createBitcoinCheckout() {
    const response = await fetch('/members/api/btcpay/checkout', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: provideEmail ? formData.email : null,
            plan: 'annual',
            amount: 3000 // $30 in cents
        })
    });

    const {invoiceUrl, invoiceId} = await response.json();

    // Redirect to BTCPay invoice page
    window.location.href = invoiceUrl;
}
```

**Step 4: Test UI locally**

Run: `cd apps/portal && yarn dev`
Test: Toggle between Stripe and Bitcoin options
Expected: Bitcoin shows optional email checkbox, Stripe requires email

**Step 5: Commit**

```bash
git add apps/portal/src/components/pages/SignupPage.js
git commit -m "feat(portal): add email-optional UI for Bitcoin checkout"
```

---

## Task 6: Display Bearer Token After Anonymous Payment

**Goal:** Show bearer token URL to anonymous Bitcoin subscribers after payment

**Files:**
- Create: `apps/portal/src/components/pages/PaymentSuccessPage.js`
- Modify: `apps/portal/src/App.js`

---

**Step 1: Create payment success page component**

Create: `apps/portal/src/components/pages/PaymentSuccessPage.js`

```javascript
import React from 'react';
import {useLocation} from 'react-router-dom';

export default function PaymentSuccessPage() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const accessToken = params.get('access_token');
    const email = params.get('email');

    if (accessToken) {
        // Anonymous Bitcoin subscriber
        const accessUrl = `${window.location.origin}/access/${accessToken}`;

        return (
            <div className="success-page anonymous">
                <h1>✅ Payment Successful!</h1>
                <p>Your Bitcoin payment has been confirmed.</p>

                <div className="access-token-box">
                    <h2>⚠️ Save This Access Link</h2>
                    <p>Bookmark this URL to access your subscription:</p>
                    <code>{accessUrl}</code>
                    <button onClick={() => navigator.clipboard.writeText(accessUrl)}>
                        Copy to Clipboard
                    </button>
                </div>

                <div className="warning">
                    <p><strong>Important:</strong> This link cannot be recovered if lost.</p>
                    <p>No email was provided, so we have no way to send it to you again.</p>
                </div>

                <a href={accessUrl} className="btn-primary">
                    Access Your Content Now →
                </a>
            </div>
        );
    }

    if (email) {
        // Email-based subscriber (Stripe or Bitcoin with email)
        return (
            <div className="success-page email">
                <h1>✅ Payment Successful!</h1>
                <p>Check your email for a magic link to access your subscription.</p>
                <p>Email sent to: <strong>{email}</strong></p>
            </div>
        );
    }

    return (
        <div className="success-page">
            <h1>✅ Payment Successful!</h1>
            <p>Your payment has been processed.</p>
        </div>
    );
}
```

**Step 2: Add route to app**

Modify: `apps/portal/src/App.js`

```javascript
import PaymentSuccessPage from './components/pages/PaymentSuccessPage';

// Add route
<Route path="/success" element={<PaymentSuccessPage />} />
```

**Step 3: Update webhook to redirect with token**

Modify: `ghost/core/core/server/services/payments/btcpay-webhook-controller.js`

In handleInvoiceSettled, add redirect URL:

```javascript
// After creating subscription
if (accessToken) {
    // Store redirect URL in metadata for portal to fetch
    await this.invoiceModel.update({
        redirect_url: `/success?access_token=${accessToken}`
    }, {id: invoiceId});
} else {
    await this.invoiceModel.update({
        redirect_url: `/success?email=${memberEmail}`
    }, {id: invoiceId});
}
```

**Step 4: Test success page**

Visit: `http://localhost:3000/success?access_token=abc123`
Expected: Shows bearer token URL with copy button

**Step 5: Commit**

```bash
git add apps/portal/src/components/pages/PaymentSuccessPage.js apps/portal/src/App.js ghost/core/core/server/services/payments/btcpay-webhook-controller.js
git commit -m "feat(portal): display bearer token URL after anonymous payment"
```

---

## Task 7: Register Payment Services in Ghost

**Goal:** Initialize payment services and webhook routes on Ghost startup

**Files:**
- Modify: `ghost/core/core/server/services/index.js:20-40`
- Create: `ghost/core/core/server/services/payments/index.js`

---

**Step 1: Create payment service factory**

Create: `ghost/core/core/server/services/payments/index.js`

```javascript
const BTCPayProvider = require('./btcpay-provider');
const BTCPayWebhookController = require('./btcpay-webhook-controller');
const pricingConfig = require('./pricing-config');

class PaymentService {
    constructor({config, models}) {
        this.config = config;
        this.models = models;
        this.providers = new Map();

        // Initialize BTCPay provider if configured
        if (config.get('btcpay:enabled')) {
            this.providers.set('btcpay', new BTCPayProvider({
                apiUrl: config.get('btcpay:apiUrl'),
                apiKey: config.get('btcpay:apiKey'),
                storeId: config.get('btcpay:storeId'),
                webhookSecret: config.get('btcpay:webhookSecret')
            }));
        }

        // Initialize webhook controller
        this.webhookController = new BTCPayWebhookController({
            provider: this.providers.get('btcpay'),
            models: models,
            pricingConfig: pricingConfig
        });
    }

    getProvider(name) {
        return this.providers.get(name);
    }

    getWebhookController() {
        return this.webhookController;
    }
}

module.exports = PaymentService;
```

**Step 2: Register service in Ghost**

Modify: `ghost/core/core/server/services/index.js`

Add near the top:
```javascript
const PaymentService = require('./payments');
```

Add to initialization:
```javascript
// In init() function
const paymentService = new PaymentService({
    config: config,
    models: models
});

// Store for route access
services.payment = paymentService;
```

**Step 3: Add BTCPay webhook route**

Modify: `ghost/core/core/server/web/api/endpoints/members/routes.js`

Add webhook route:
```javascript
const express = require('express');
const bodyParser = require('body-parser');

// Add raw body parser for webhook signature verification
router.post('/webhooks/btcpay',
    bodyParser.raw({type: 'application/json'}),
    async (req, res) => {
        const services = require('../../../../services');
        const webhookController = services.payment.getWebhookController();

        try {
            await webhookController.handleWebhook(req, res);
        } catch (err) {
            console.error('BTCPay webhook error:', err);
            res.status(500).json({error: 'Webhook processing failed'});
        }
    }
);
```

**Step 4: Test service initialization**

Run: `yarn dev`
Check logs: Should see "Payment services initialized"
Expected: No errors on startup

**Step 5: Commit**

```bash
git add ghost/core/core/server/services/payments/index.js ghost/core/core/server/services/index.js ghost/core/core/server/web/api/endpoints/members/routes.js
git commit -m "feat(payments): register payment services and webhook routes"
```

---

## Task 8: End-to-End Testing

**Goal:** Verify complete payment flows for all scenarios

**Files:**
- Create: `ghost/core/test/e2e/payments/stripe-minimal.test.js`
- Create: `ghost/core/test/e2e/payments/bitcoin-anonymous.test.js`
- Create: `ghost/core/test/e2e/payments/bitcoin-email.test.js`

---

**Step 1: Test Stripe with minimal data**

Create: `ghost/core/test/e2e/payments/stripe-minimal.test.js`

```javascript
const {expect} = require('@playwright/test');
const {test} = require('../../utils/e2e-framework');

test.describe('Stripe Minimal Data Collection', () => {
    test('should accept payment with only email and ZIP', async ({page}) => {
        await page.goto('/signup');

        // Select Stripe payment
        await page.click('[data-test="payment-stripe"]');

        // Fill minimal form
        await page.fill('[name="email"]', 'test@example.com');
        await page.fill('[name="postal_code"]', '12345');

        // Verify name and address fields are NOT present
        const nameField = page.locator('[name="name"]');
        await expect(nameField).not.toBeVisible();

        const addressField = page.locator('[name="address_line1"]');
        await expect(addressField).not.toBeVisible();

        // Submit (use Stripe test card)
        await page.click('[data-test="submit-payment"]');

        // Should redirect to Stripe
        await expect(page).toHaveURL(/checkout\.stripe\.com/);
    });
});
```

**Step 2: Test Bitcoin anonymous flow**

Create: `ghost/core/test/e2e/payments/bitcoin-anonymous.test.js`

```javascript
const {expect} = require('@playwright/test');
const {test} = require('../../utils/e2e-framework');

test.describe('Bitcoin Anonymous Subscription', () => {
    test('should create subscription without email and show bearer token', async ({page}) => {
        await page.goto('/signup');

        // Select Bitcoin payment
        await page.click('[data-test="payment-bitcoin"]');

        // Uncheck email option
        const emailCheckbox = page.locator('[data-test="provide-email"]');
        await emailCheckbox.uncheck();

        // Verify warning message
        const warning = page.locator('.warning');
        await expect(warning).toContainText('bookmark-only access link');

        // Submit
        await page.click('[data-test="submit-payment"]');

        // Should redirect to BTCPay (mock in test)
        await expect(page).toHaveURL(/btcpay/);

        // Simulate webhook (test helper)
        await test.step('Simulate BTCPay webhook', async () => {
            // This would be done via API in real test
            const response = await page.request.post('/members/api/webhooks/btcpay', {
                data: {
                    type: 'InvoiceSettled',
                    invoiceId: 'test_inv_123',
                    metadata: {
                        memberEmail: null,
                        tier: 'annual'
                    }
                },
                headers: {
                    'btcpay-sig': 'test_signature'
                }
            });
            expect(response.ok()).toBeTruthy();
        });

        // Should redirect to success page with token
        await page.goto('/success?access_token=abc123def456...');

        // Verify bearer token is displayed
        const tokenBox = page.locator('.access-token-box');
        await expect(tokenBox).toBeVisible();
        await expect(tokenBox).toContainText('/access/');

        // Test copy button
        await page.click('button:has-text("Copy to Clipboard")');
        // Clipboard assertion would go here
    });
});
```

**Step 3: Test Bitcoin with email**

Create: `ghost/core/test/e2e/payments/bitcoin-email.test.js`

```javascript
const {expect} = require('@playwright/test');
const {test} = require('../../utils/e2e-framework');

test.describe('Bitcoin Subscription with Email', () => {
    test('should create subscription with email and send magic link', async ({page}) => {
        await page.goto('/signup');

        // Select Bitcoin payment
        await page.click('[data-test="payment-bitcoin"]');

        // Check email option
        const emailCheckbox = page.locator('[data-test="provide-email"]');
        await emailCheckbox.check();

        // Fill email
        await page.fill('[name="email"]', 'test@example.com');

        // Submit
        await page.click('[data-test="submit-payment"]');

        // Simulate webhook with email
        await test.step('Simulate BTCPay webhook', async () => {
            const response = await page.request.post('/members/api/webhooks/btcpay', {
                data: {
                    type: 'InvoiceSettled',
                    invoiceId: 'test_inv_456',
                    metadata: {
                        memberEmail: 'test@example.com',
                        tier: 'annual'
                    }
                }
            });
            expect(response.ok()).toBeTruthy();
        });

        // Should redirect to success page with email confirmation
        await page.goto('/success?email=test@example.com');

        await expect(page.locator('.success-page')).toContainText('Check your email');
        await expect(page.locator('.success-page')).toContainText('test@example.com');
    });
});
```

**Step 4: Run all E2E tests**

Run: `yarn test:e2e ghost/core/test/e2e/payments/`
Expected: All tests pass

**Step 5: Commit**

```bash
git add ghost/core/test/e2e/payments/
git commit -m "test(payments): add E2E tests for all payment flows"
```

---

## Task 9: Update Documentation

**Goal:** Document the implemented features for future developers

**Files:**
- Update: `IMPLEMENTATION_STATUS.md`
- Create: `docs/ANONYMOUS_SUBSCRIPTIONS.md`

---

**Step 1: Update implementation status**

Modify: `IMPLEMENTATION_STATUS.md`

Update the "What's NOT Yet Done" section:

```markdown
## ✅ Recently Completed (Phase 1)

### Anonymous Bitcoin Subscriptions ✅
**Status**: Implemented
**Location**: `ghost/core/core/server/services/payments/`

**Features**:
- Bearer token generation for email-less subscriptions
- `/access/:token` route for token-based authentication
- Email-optional UI in Portal
- Success page showing bearer token URL

**Effort**: ~8 hours of development (completed)

---

## ⏳ What's NOT Yet Done

### 1. Portal UI Updates ⚠️
**Status**: PARTIALLY COMPLETE
**Location**: `apps/portal/src/components/pages/SignupPage.js`

**Completed**:
- ✅ Minimal Stripe data collection (email + ZIP only)
- ✅ Bitcoin payment method selector
- ✅ Email-optional UI for Bitcoin
- ✅ Bearer token display after payment

**Still Needed**:
- [ ] Pricing comparison table
- [ ] Feature comparison
- [ ] Better mobile responsiveness

**Effort**: 2-4 hours of React development
```

**Step 2: Create anonymous subscriptions guide**

Create: `docs/ANONYMOUS_SUBSCRIPTIONS.md`

```markdown
# Anonymous Bitcoin Subscriptions

## Overview

Ghost now supports completely anonymous subscriptions via Bitcoin payments. Subscribers can pay without providing any personal information and access content using a bearer token URL.

## How It Works

### For Subscribers

1. **Choose Bitcoin payment** on signup page
2. **Uncheck email option** (optional)
3. **Pay Bitcoin invoice** via Lightning or on-chain
4. **Receive bearer token URL** after payment:
   ```
   https://yoursite.com/access/abc123def456...
   ```
5. **Bookmark the URL** - this is your only way to access content

### For Creators

Anonymous subscribers appear in your Ghost admin with:
- No email address
- "Bearer Token" access type
- Active subscription status

You cannot email anonymous subscribers, but they can access all member content.

## Technical Implementation

### Database Schema

```sql
-- Added to members_crypto_subscriptions table
access_token VARCHAR(64) UNIQUE NULL
```

### Bearer Token Generation

Tokens are generated using Node.js crypto module:

```javascript
const crypto = require('crypto');
const accessToken = crypto.randomBytes(32).toString('hex'); // 64 hex characters
```

### Authentication Flow

1. Subscriber visits `/access/:token`
2. Ghost validates token against database
3. Sets auth cookie with member ID
4. Redirects to homepage
5. Cookie persists for 1 year

### Security Considerations

- Tokens are 256-bit random (64 hex chars)
- Cookie is httpOnly, secure, sameSite=strict
- No token recovery mechanism (intentional)
- Tokens don't expire (subscription expiry is separate)

## Testing

### Manual Testing

1. Start Ghost: `yarn dev`
2. Visit: `http://localhost:2368/signup`
3. Select Bitcoin, uncheck email
4. Simulate BTCPay webhook (see below)
5. Visit success page with token
6. Test access URL

### Webhook Simulation

```bash
curl -X POST http://localhost:2368/members/api/webhooks/btcpay \
  -H "Content-Type: application/json" \
  -d '{
    "type": "InvoiceSettled",
    "invoiceId": "test_123",
    "metadata": {
      "memberEmail": null,
      "tier": "annual"
    }
  }'
```

## Limitations

- No password reset (no email to send to)
- No renewal reminders (no email)
- Can't leave comments (anonymous)
- Can't update profile (anonymous)
- If token is lost, must purchase new subscription

## Future Enhancements

- [ ] Lightning address as identifier
- [ ] Nostr key authentication
- [ ] Token refresh mechanism
- [ ] Multiple device support
- [ ] Anonymous commenting
```

**Step 3: Commit documentation**

```bash
git add IMPLEMENTATION_STATUS.md docs/ANONYMOUS_SUBSCRIPTIONS.md
git commit -m "docs: update implementation status and add anonymous subscriptions guide"
```

---

## Task 10: Final Integration Testing

**Goal:** Verify all pieces work together end-to-end

**Files:**
- No file changes, testing only

---

**Step 1: Test Stripe flow**

Manual test:
1. Start Ghost: `yarn dev`
2. Visit: `http://localhost:2368/signup`
3. Select Stripe
4. Enter: email + ZIP only
5. Submit (use Stripe test card: 4242 4242 4242 4242)
6. Verify: Redirects to Stripe checkout
7. Complete payment
8. Verify: Member created in database
9. Check: Only email and ZIP stored

**Step 2: Test Bitcoin with email flow**

Manual test:
1. Visit: `http://localhost:2368/signup`
2. Select Bitcoin
3. Check "Provide email"
4. Enter: test@example.com
5. Submit
6. Verify: BTCPay invoice created
7. Simulate webhook (see above)
8. Verify: Member created with email
9. Verify: Magic link sent
10. Check: No access_token in database

**Step 3: Test Bitcoin anonymous flow**

Manual test:
1. Visit: `http://localhost:2368/signup`
2. Select Bitcoin
3. Uncheck "Provide email"
4. Submit
5. Verify: BTCPay invoice created
6. Simulate webhook with no email
7. Verify: Member created without email
8. Verify: access_token generated (64 chars)
9. Visit: `/success?access_token=<token>`
10. Copy bearer token URL
11. Visit: `/access/<token>`
12. Verify: Cookie set, redirected to homepage
13. Verify: Can access member content

**Step 4: Test error cases**

Test:
1. Invalid bearer token (wrong length)
2. Non-existent bearer token
3. Expired subscription with valid token
4. Webhook with invalid signature
5. Duplicate webhook delivery

Expected: All error cases handled gracefully

**Step 5: Performance testing**

Test:
1. Token lookup performance (database index)
2. Cookie size (keep under 4KB)
3. Webhook processing time (<500ms)

**Step 6: Document test results**

Create: `docs/TEST_RESULTS.md` with all test cases and results

**Step 7: Final commit**

```bash
git add docs/TEST_RESULTS.md
git commit -m "test: complete Phase 1 integration testing"
```

---

## Completion Checklist

Phase 1 is complete when:

- [ ] All 10 tasks completed
- [ ] All tests passing (unit + E2E)
- [ ] Documentation updated
- [ ] Manual testing successful
- [ ] Code committed to git
- [ ] No console errors on startup
- [ ] Bearer tokens generated correctly
- [ ] Access route working
- [ ] Portal UI updated
- [ ] Services registered
- [ ] Webhooks processing correctly

## Next Steps

After Phase 1 completion:

**Phase 2: Build Hosting Platform Portal (Tier 1)**
- Creator portal application
- Docker integration
- Billing system for hosting fees
- Domain management

**Phase 3: Container Orchestration**
- Base Ghost Docker image
- Caddy reverse proxy
- Automated provisioning
- Backup system

**Phase 4: Integration & Testing**
- End-to-end testing across both tiers
- Production deployment
- Monitoring setup

---

## Plan Status

**Phase 1 Tasks**: 10 tasks
**Estimated Time**: 12-15 hours
**Dependencies**: Existing BTCPay integration code
**Blockers**: None

**Ready for execution**: ✅
