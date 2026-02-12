/**
 * Payment Service Factory
 * Central service for managing multiple payment providers (Stripe + BTCPay)
 */

const config = require('../../../shared/config');
const StripeProvider = require('../stripe/stripe-api'); // Use existing Stripe service
const BTCPayProvider = require('./btcpay-provider');
const {getAllPricingOptions, findTierByPriceId} = require('./pricing-config');

class PaymentService {
    constructor(deps) {
        this.providers = {};
        this.defaultProvider = 'stripe';

        // Initialize Stripe (existing provider)
        if (deps.stripeConfig && deps.stripeConfig.secretKey) {
            this.providers.stripe = deps.stripeProvider || new StripeProvider(deps);
            this.defaultProvider = 'stripe';
        }

        // Initialize BTCPay (new provider)
        if (deps.btcpayConfig && deps.btcpayConfig.apiUrl) {
            this.providers.btcpay = new BTCPayProvider(deps.btcpayConfig);
        }
    }

    /**
     * Get a specific payment provider
     * @param {string} provider - Provider name ('stripe' or 'btcpay')
     * @returns {PaymentProvider}
     */
    getProvider(provider = null) {
        const providerName = provider || this.defaultProvider;
        const selectedProvider = this.providers[providerName];

        if (!selectedProvider) {
            throw new Error(`Payment provider '${providerName}' not configured`);
        }

        if (!selectedProvider.isConfigured()) {
            throw new Error(`Payment provider '${providerName}' is not properly configured`);
        }

        return selectedProvider;
    }

    /**
     * Get all available payment providers
     * @returns {Array<string>} Array of provider names
     */
    getAvailableProviders() {
        return Object.keys(this.providers).filter(name => {
            return this.providers[name].isConfigured();
        });
    }

    /**
     * Check if a specific provider is available
     * @param {string} provider - Provider name
     * @returns {boolean}
     */
    isProviderAvailable(provider) {
        return this.providers[provider] && this.providers[provider].isConfigured();
    }

    /**
     * Get pricing options for a tier across all providers
     * @param {string} tierId - Tier identifier (e.g., 'annual_membership')
     * @returns {Object} Pricing options for all providers
     */
    getPricingOptions(tierId = 'annual_membership') {
        return getAllPricingOptions(tierId);
    }

    /**
     * Create checkout session with specified provider
     * @param {string} provider - Provider name ('stripe' or 'btcpay')
     * @param {Object} options - Checkout options
     * @returns {Promise<{sessionId: string, checkoutUrl: string}>}
     */
    async createCheckoutSession(provider, options) {
        const paymentProvider = this.getProvider(provider);
        return paymentProvider.createCheckoutSession(options);
    }

    /**
     * Handle webhook from any provider
     * Routes webhook to correct provider based on signature/headers
     * @param {string} provider - Provider name
     * @param {Object} req - Express request object
     * @returns {Promise<Object>} Parsed event
     */
    async handleWebhook(provider, req) {
        const paymentProvider = this.getProvider(provider);

        // Get signature from headers (provider-specific)
        let signature;
        if (provider === 'stripe') {
            signature = req.headers['stripe-signature'];
        } else if (provider === 'btcpay') {
            signature = req.headers['btcpay-sig'];
        }

        // Get raw body
        const payload = req.rawBody || req.body;

        // Parse and verify webhook
        return paymentProvider.parseWebhookEvent(payload, signature);
    }

    /**
     * Get subscription from any provider
     * @param {string} provider - Provider name
     * @param {string} subscriptionId - Subscription ID
     * @returns {Promise<Object>} Normalized subscription object
     */
    async getSubscription(provider, subscriptionId) {
        const paymentProvider = this.getProvider(provider);
        return paymentProvider.getSubscription(subscriptionId);
    }

    /**
     * Cancel subscription
     * @param {string} provider - Provider name
     * @param {string} subscriptionId - Subscription ID
     * @param {boolean} immediately - Cancel immediately vs. at period end
     * @returns {Promise<Object>} Updated subscription
     */
    async cancelSubscription(provider, subscriptionId, immediately = false) {
        const paymentProvider = this.getProvider(provider);

        if (immediately) {
            return paymentProvider.cancelSubscriptionImmediately(subscriptionId);
        } else {
            return paymentProvider.cancelSubscription(subscriptionId);
        }
    }

    /**
     * Reactivate a canceled subscription
     * @param {string} provider - Provider name
     * @param {string} subscriptionId - Subscription ID
     * @returns {Promise<Object>} Reactivated subscription
     */
    async reactivateSubscription(provider, subscriptionId) {
        const paymentProvider = this.getProvider(provider);
        return paymentProvider.reactivateSubscription(subscriptionId);
    }

    /**
     * Create billing portal session
     * @param {string} provider - Provider name
     * @param {string} customerId - Customer ID
     * @param {string} returnUrl - Return URL after managing subscription
     * @returns {Promise<{url: string}>}
     */
    async createBillingPortalSession(provider, customerId, returnUrl) {
        const paymentProvider = this.getProvider(provider);
        return paymentProvider.createBillingPortalSession(customerId, returnUrl);
    }

    /**
     * Get member's active subscription (from any provider)
     * @param {string} memberId - Ghost member ID
     * @returns {Promise<Object|null>} Active subscription or null
     */
    async getMemberActiveSubscription(memberId) {
        const knex = require('../../data/db/connection');

        // Check Stripe subscriptions
        const stripeSubscription = await knex('members_stripe_customers_subscriptions')
            .join('members_stripe_customers', 'members_stripe_customers_subscriptions.customer_id', 'members_stripe_customers.customer_id')
            .where('members_stripe_customers.member_id', memberId)
            .whereIn('members_stripe_customers_subscriptions.status', ['active', 'trialing'])
            .first();

        if (stripeSubscription) {
            return {
                provider: 'stripe',
                subscription: stripeSubscription
            };
        }

        // Check crypto subscriptions
        const cryptoSubscription = await knex('members_crypto_subscriptions')
            .where('member_id', memberId)
            .whereIn('status', ['active', 'trialing'])
            .first();

        if (cryptoSubscription) {
            return {
                provider: cryptoSubscription.provider,
                subscription: cryptoSubscription
            };
        }

        return null;
    }

    /**
     * Check if member has any active subscription
     * @param {string} memberId - Ghost member ID
     * @returns {Promise<boolean>}
     */
    async memberHasActiveSubscription(memberId) {
        const subscription = await this.getMemberActiveSubscription(memberId);
        return subscription !== null;
    }

    /**
     * Get all subscriptions for a member (all providers)
     * @param {string} memberId - Ghost member ID
     * @returns {Promise<Array>} Array of subscriptions with provider info
     */
    async getMemberSubscriptions(memberId) {
        const knex = require('../../data/db/connection');
        const subscriptions = [];

        // Get Stripe subscriptions
        const stripeSubscriptions = await knex('members_stripe_customers_subscriptions')
            .join('members_stripe_customers', 'members_stripe_customers_subscriptions.customer_id', 'members_stripe_customers.customer_id')
            .where('members_stripe_customers.member_id', memberId)
            .select('members_stripe_customers_subscriptions.*');

        subscriptions.push(...stripeSubscriptions.map(sub => ({
            provider: 'stripe',
            ...sub
        })));

        // Get crypto subscriptions
        const cryptoSubscriptions = await knex('members_crypto_subscriptions')
            .where('member_id', memberId);

        subscriptions.push(...cryptoSubscriptions);

        return subscriptions;
    }
}

// Initialize singleton instance with config from environment
let paymentServiceInstance = null;

function getPaymentService() {
    if (!paymentServiceInstance) {
        const stripeConfig = config.get('stripe');
        const btcpayConfig = config.get('btcpay');

        paymentServiceInstance = new PaymentService({
            stripeConfig,
            stripeProvider: null, // Will use existing Stripe service
            btcpayConfig
        });
    }

    return paymentServiceInstance;
}

// Export singleton instance
module.exports = getPaymentService();
module.exports.PaymentService = PaymentService; // Export class for testing

