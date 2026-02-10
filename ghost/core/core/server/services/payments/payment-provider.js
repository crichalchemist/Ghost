/**
 * Abstract Payment Provider Interface
 * Allows switching between Stripe, BTCPay, or other payment processors
 *
 * All payment providers must implement this interface
 */
class PaymentProvider {
    /**
     * Initialize the payment provider
     * @param {Object} config - Provider-specific configuration
     */
    constructor(config) {
        this.config = config;
        this.name = 'base';
    }

    /**
     * Check if provider is properly configured
     * @returns {boolean}
     */
    isConfigured() {
        throw new Error('isConfigured() must be implemented by provider');
    }

    /**
     * Create a checkout session for a new subscription
     * @param {Object} options
     * @param {string} options.priceId - Plan/price identifier
     * @param {string} options.memberEmail - Member email address
     * @param {string} [options.memberId] - Existing member ID (optional)
     * @param {string} options.successUrl - Redirect URL on success
     * @param {string} options.cancelUrl - Redirect URL on cancel
     * @param {Object} [options.metadata] - Additional metadata
     * @returns {Promise<{sessionId: string, checkoutUrl: string}>}
     */
    async createCheckoutSession(options) {
        throw new Error('createCheckoutSession() must be implemented by provider');
    }

    /**
     * Create a checkout session for one-time payment (donation, tip, etc.)
     * @param {Object} options
     * @param {number} options.amount - Amount in cents
     * @param {string} options.currency - Currency code (usd, eur, etc.)
     * @param {string} options.memberEmail - Member email
     * @param {string} options.successUrl - Success redirect URL
     * @param {string} options.cancelUrl - Cancel redirect URL
     * @param {Object} [options.metadata] - Additional metadata
     * @returns {Promise<{sessionId: string, checkoutUrl: string}>}
     */
    async createOneTimePayment(options) {
        throw new Error('createOneTimePayment() must be implemented by provider');
    }

    /**
     * Verify webhook signature to ensure request is from payment provider
     * @param {string|Buffer} payload - Raw webhook body
     * @param {string} signature - Signature header from webhook
     * @param {string} [secret] - Webhook secret (if different from config)
     * @returns {boolean}
     */
    verifyWebhookSignature(payload, signature, secret) {
        throw new Error('verifyWebhookSignature() must be implemented by provider');
    }

    /**
     * Parse webhook event
     * @param {string|Buffer} payload - Raw webhook body
     * @param {string} signature - Signature header
     * @returns {Promise<Object>} Parsed event object
     */
    async parseWebhookEvent(payload, signature) {
        throw new Error('parseWebhookEvent() must be implemented by provider');
    }

    /**
     * Get subscription details
     * @param {string} subscriptionId - Provider's subscription ID
     * @returns {Promise<Object>} Subscription object with standardized fields
     */
    async getSubscription(subscriptionId) {
        throw new Error('getSubscription() must be implemented by provider');
    }

    /**
     * Update subscription (e.g., change plan, update payment method)
     * @param {string} subscriptionId - Provider's subscription ID
     * @param {Object} updates - Updates to apply
     * @returns {Promise<Object>} Updated subscription object
     */
    async updateSubscription(subscriptionId, updates) {
        throw new Error('updateSubscription() must be implemented by provider');
    }

    /**
     * Cancel subscription at end of period
     * @param {string} subscriptionId - Provider's subscription ID
     * @returns {Promise<Object>} Updated subscription object
     */
    async cancelSubscription(subscriptionId) {
        throw new Error('cancelSubscription() must be implemented by provider');
    }

    /**
     * Cancel subscription immediately
     * @param {string} subscriptionId - Provider's subscription ID
     * @returns {Promise<Object>} Canceled subscription object
     */
    async cancelSubscriptionImmediately(subscriptionId) {
        throw new Error('cancelSubscriptionImmediately() must be implemented by provider');
    }

    /**
     * Reactivate a canceled subscription
     * @param {string} subscriptionId - Provider's subscription ID
     * @returns {Promise<Object>} Reactivated subscription object
     */
    async reactivateSubscription(subscriptionId) {
        throw new Error('reactivateSubscription() must be implemented by provider');
    }

    /**
     * Get customer/member details from provider
     * @param {string} customerId - Provider's customer ID
     * @returns {Promise<Object>} Customer object
     */
    async getCustomer(customerId) {
        throw new Error('getCustomer() must be implemented by provider');
    }

    /**
     * Create or update customer in provider's system
     * @param {Object} customerData - Customer data
     * @param {string} customerData.email - Customer email
     * @param {string} [customerData.name] - Customer name
     * @param {Object} [customerData.metadata] - Additional metadata
     * @returns {Promise<Object>} Customer object
     */
    async createOrUpdateCustomer(customerData) {
        throw new Error('createOrUpdateCustomer() must be implemented by provider');
    }

    /**
     * Create a billing portal session for customer to manage subscription
     * @param {string} customerId - Provider's customer ID
     * @param {string} returnUrl - URL to return to after managing subscription
     * @returns {Promise<{url: string}>} Portal session URL
     */
    async createBillingPortalSession(customerId, returnUrl) {
        throw new Error('createBillingPortalSession() must be implemented by provider');
    }

    /**
     * Get invoice details
     * @param {string} invoiceId - Provider's invoice ID
     * @returns {Promise<Object>} Invoice object
     */
    async getInvoice(invoiceId) {
        throw new Error('getInvoice() must be implemented by provider');
    }

    /**
     * List all invoices for a customer
     * @param {string} customerId - Provider's customer ID
     * @param {Object} [options] - Query options (limit, offset, etc.)
     * @returns {Promise<Array>} Array of invoice objects
     */
    async listInvoices(customerId, options = {}) {
        throw new Error('listInvoices() must be implemented by provider');
    }

    /**
     * Get provider name
     * @returns {string} Provider name (e.g., 'stripe', 'btcpay')
     */
    getName() {
        return this.name;
    }

    /**
     * Normalize subscription object to standard format
     * Each provider returns different data structures - this normalizes them
     * @param {Object} subscription - Provider-specific subscription object
     * @returns {Object} Normalized subscription
     */
    normalizeSubscription(subscription) {
        // Default implementation - providers should override
        return {
            id: subscription.id,
            status: subscription.status,
            amount: subscription.amount,
            currency: subscription.currency,
            interval: subscription.interval,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            provider: this.getName()
        };
    }

    /**
     * Normalize invoice object to standard format
     * @param {Object} invoice - Provider-specific invoice object
     * @returns {Object} Normalized invoice
     */
    normalizeInvoice(invoice) {
        // Default implementation - providers should override
        return {
            id: invoice.id,
            amount: invoice.amount,
            currency: invoice.currency,
            status: invoice.status,
            created: invoice.created,
            paid_at: invoice.paid_at || null,
            provider: this.getName()
        };
    }
}

module.exports = PaymentProvider;

