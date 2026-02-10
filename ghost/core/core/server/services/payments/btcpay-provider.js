const PaymentProvider = require('./payment-provider');
const crypto = require('crypto');
const {getPricing} = require('./pricing-config');

/**
 * BTCPay Server Payment Provider
 * Implements PaymentProvider interface for BTCPay Server integration
 */
class BTCPayProvider extends PaymentProvider {
    constructor(config) {
        super(config);
        this.name = 'btcpay';
        this.apiUrl = config.apiUrl; // e.g., https://btcpay.yourdomain.com
        this.apiToken = config.apiToken;
        this.storeId = config.storeId;
        this.webhookSecret = config.webhookSecret;
    }

    isConfigured() {
        return !!(this.apiUrl && this.apiToken && this.storeId && this.webhookSecret);
    }

    async createCheckoutSession(options) {
        const {priceId, memberEmail, memberId, successUrl, cancelUrl, metadata = {}} = options;

        // Get pricing configuration
        const pricing = getPricing('annual_membership', 'btcpay');
        if (!pricing) {
            throw new Error('BTCPay pricing not configured');
        }

        // Create BTCPay invoice
        const invoiceData = {
            amount: (pricing.amount / 100).toFixed(2), // Convert cents to dollars
            currency: pricing.currency.toUpperCase(),
            checkout: {
                speedPolicy: pricing.speed_policy || 'HighSpeed',
                redirectURL: successUrl,
                redirectAutomatically: true,
                defaultLanguage: 'en'
            },
            metadata: {
                ...metadata,
                memberEmail,
                memberId: memberId || null,
                priceId,
                ghost_subscription: true,
                ghost_annual_membership: true,
                interval: pricing.interval
            }
        };

        const response = await this._makeRequest(
            'POST',
            `/api/v1/stores/${this.storeId}/invoices`,
            invoiceData
        );

        return {
            sessionId: response.id,
            checkoutUrl: response.checkoutLink
        };
    }

    async createOneTimePayment(options) {
        const {amount, currency, memberEmail, successUrl, cancelUrl, metadata = {}} = options;

        const invoiceData = {
            amount: (amount / 100).toFixed(2), // Convert cents to dollars
            currency: currency.toUpperCase(),
            checkout: {
                speedPolicy: 'HighSpeed',
                redirectURL: successUrl,
                redirectAutomatically: true
            },
            metadata: {
                ...metadata,
                memberEmail,
                ghost_one_time_payment: true
            }
        };

        const response = await this._makeRequest(
            'POST',
            `/api/v1/stores/${this.storeId}/invoices`,
            invoiceData
        );

        return {
            sessionId: response.id,
            checkoutUrl: response.checkoutLink
        };
    }

    verifyWebhookSignature(payload, signature, secret) {
        const webhookSecret = secret || this.webhookSecret;

        // BTCPay uses HMAC-SHA256
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
            .digest('hex');

        // BTCPay signature format: "sha256=<hex>"
        const receivedSignature = signature.replace('sha256=', '');

        try {
            return crypto.timingSafeEqual(
                Buffer.from(receivedSignature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            );
        } catch (e) {
            return false;
        }
    }

    async parseWebhookEvent(payload, signature) {
        if (!this.verifyWebhookSignature(payload, signature)) {
            throw new Error('Invalid webhook signature');
        }

        const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
        return event;
    }

    async getSubscription(subscriptionId) {
        // BTCPay doesn't have native subscriptions
        // We manage subscriptions in Ghost's database
        // This method queries our crypto_subscriptions table
        const knex = require('../../data/db/connection');

        const subscription = await knex('members_crypto_subscriptions')
            .where('subscription_id', subscriptionId)
            .where('provider', 'btcpay')
            .first();

        if (!subscription) {
            throw new Error(`Subscription ${subscriptionId} not found`);
        }

        return this.normalizeSubscription(subscription);
    }

    async updateSubscription(subscriptionId, updates) {
        const knex = require('../../data/db/connection');

        await knex('members_crypto_subscriptions')
            .where('subscription_id', subscriptionId)
            .where('provider', 'btcpay')
            .update({
                ...updates,
                updated_at: new Date()
            });

        return this.getSubscription(subscriptionId);
    }

    async cancelSubscription(subscriptionId) {
        return this.updateSubscription(subscriptionId, {
            cancel_at_period_end: true,
            status: 'active' // Remains active until period end
        });
    }

    async cancelSubscriptionImmediately(subscriptionId) {
        return this.updateSubscription(subscriptionId, {
            status: 'canceled',
            cancel_at_period_end: true
        });
    }

    async reactivateSubscription(subscriptionId) {
        return this.updateSubscription(subscriptionId, {
            cancel_at_period_end: false,
            status: 'active'
        });
    }

    async getCustomer(customerId) {
        // BTCPay doesn't have customer concept
        // Return member data from Ghost
        const knex = require('../../data/db/connection');

        const provider = await knex('members_crypto_providers')
            .where('customer_id', customerId)
            .where('provider', 'btcpay')
            .first();

        if (!provider) {
            throw new Error(`Customer ${customerId} not found`);
        }

        return provider;
    }

    async createOrUpdateCustomer(customerData) {
        const knex = require('../../data/db/connection');
        const {email, memberId, metadata = {}} = customerData;

        // Check if customer exists
        let provider = await knex('members_crypto_providers')
            .where('member_id', memberId)
            .where('provider', 'btcpay')
            .first();

        if (provider) {
            // Update existing
            await knex('members_crypto_providers')
                .where('id', provider.id)
                .update({
                    metadata: JSON.stringify(metadata),
                    updated_at: new Date()
                });
        } else {
            // Create new
            provider = {
                id: require('crypto').randomUUID(),
                member_id: memberId,
                provider: 'btcpay',
                customer_id: `btc_${memberId}`,
                metadata: JSON.stringify(metadata),
                created_at: new Date()
            };

            await knex('members_crypto_providers').insert(provider);
        }

        return provider;
    }

    async createBillingPortalSession(customerId, returnUrl) {
        // BTCPay doesn't have a billing portal like Stripe
        // Instead, we'll return a URL to the Ghost member portal
        // where members can manage their subscription
        const siteUrl = process.env.SITE_URL || 'http://localhost:2368';

        return {
            url: `${siteUrl}/account/?action=manage-subscription&provider=btcpay`
        };
    }

    async getInvoice(invoiceId) {
        const response = await this._makeRequest(
            'GET',
            `/api/v1/stores/${this.storeId}/invoices/${invoiceId}`
        );

        return this.normalizeInvoice(response);
    }

    async listInvoices(customerId, options = {}) {
        // Get member_id from customer
        const knex = require('../../data/db/connection');
        const provider = await knex('members_crypto_providers')
            .where('customer_id', customerId)
            .first();

        if (!provider) {
            return [];
        }

        // Query our invoices table
        let query = knex('members_crypto_invoices')
            .where('member_id', provider.member_id)
            .where('provider', 'btcpay')
            .orderBy('created_at', 'desc');

        if (options.limit) {
            query = query.limit(options.limit);
        }

        if (options.offset) {
            query = query.offset(options.offset);
        }

        const invoices = await query;
        return invoices.map(inv => this.normalizeInvoice(inv));
    }

    normalizeSubscription(subscription) {
        return {
            id: subscription.subscription_id || subscription.id,
            ghost_id: subscription.id, // Our internal ID
            status: subscription.status,
            amount: subscription.amount,
            currency: subscription.currency,
            interval: subscription.interval,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            member_id: subscription.member_id,
            plan_id: subscription.plan_id,
            provider: 'btcpay'
        };
    }

    normalizeInvoice(invoice) {
        return {
            id: invoice.invoice_id || invoice.id,
            ghost_id: invoice.id, // Our internal ID if from our DB
            amount: invoice.amount_fiat || invoice.amount,
            currency: invoice.currency,
            status: invoice.status,
            created: invoice.created_at || invoice.createdTime,
            paid_at: invoice.paid_at,
            crypto_amount: invoice.amount_crypto,
            crypto_currency: invoice.crypto_currency,
            payment_method: invoice.payment_method,
            transaction_id: invoice.transaction_id,
            provider: 'btcpay'
        };
    }

    // Private helper methods

    async _makeRequest(method, path, data = null) {
        const url = `${this.apiUrl}${path}`;
        const options = {
            method,
            headers: {
                'Authorization': `token ${this.apiToken}`,
                'Content-Type': 'application/json'
            }
        };

        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }

        const fetch = require('node-fetch');
        const response = await fetch(url, options);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`BTCPay API error: ${response.status} - ${error}`);
        }

        return response.json();
    }
}

module.exports = BTCPayProvider;

