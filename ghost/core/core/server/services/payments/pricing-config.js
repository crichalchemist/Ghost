/**
 * Dual Payment Pricing Configuration
 * Stripe: $10/year | Bitcoin: $30/year
 */

const PRICING_TIERS = {
    /**
     * Annual membership with full access
     * - Stripe: $10/year (standard pricing)
     * - Bitcoin: $30/year (privacy premium)
     */
    annual_membership: {
        name: 'Annual Membership',
        description: 'Full access to all content and features',
        interval: 'year',

        stripe: {
            enabled: true,
            price_id: 'price_annual_10_usd', // Replace with actual Stripe Price ID
            amount: 1000, // $10.00 in cents
            currency: 'usd',
            display_name: 'Annual Membership',
            display_price: '$10/year',
            features: [
                'Full content access',
                'Member-only newsletters',
                'Community access',
                'All premium features'
            ]
        },

        btcpay: {
            enabled: true,
            price_id: 'btc_annual_30_usd',
            amount: 3000, // $30.00 in cents
            currency: 'usd',
            display_name: 'Annual Membership (Bitcoin)',
            display_price: '$30/year',
            display_note: 'Privacy premium - No KYC, completely anonymous',
            features: [
                'Full content access',
                'Member-only newsletters',
                'Community access',
                'All premium features',
                '✨ Zero KYC - Complete privacy',
                '✨ Censorship-resistant payment',
                '✨ Bitcoin/Lightning Network'
            ],
            // Bitcoin-specific settings
            invoice_expiry: 3600, // 1 hour
            speed_policy: 'HighSpeed', // Fast confirmation
            payment_methods: ['bitcoin', 'lightning'] // Both supported
        }
    }
};

/**
 * Get pricing for a specific tier and payment provider
 * @param {string} tierId - Tier identifier (e.g., 'annual_membership')
 * @param {string} provider - Payment provider ('stripe' or 'btcpay')
 * @returns {Object|null} Pricing configuration or null if not found
 */
function getPricing(tierId, provider) {
    const tier = PRICING_TIERS[tierId];
    if (!tier) {
        return null;
    }

    const pricing = tier[provider];
    if (!pricing || !pricing.enabled) {
        return null;
    }

    return {
        ...pricing,
        tier_name: tier.name,
        tier_description: tier.description,
        interval: tier.interval
    };
}

/**
 * Get all available pricing options for a tier
 * @param {string} tierId - Tier identifier
 * @returns {Object} Object with 'stripe' and 'btcpay' pricing if available
 */
function getAllPricingOptions(tierId) {
    const tier = PRICING_TIERS[tierId];
    if (!tier) {
        return null;
    }

    return {
        stripe: tier.stripe?.enabled ? tier.stripe : null,
        btcpay: tier.btcpay?.enabled ? tier.btcpay : null,
        tier_info: {
            name: tier.name,
            description: tier.description,
            interval: tier.interval
        }
    };
}

/**
 * Calculate savings/premium between payment methods
 * @param {string} tierId - Tier identifier
 * @returns {Object} Comparison data
 */
function comparePricing(tierId) {
    const options = getAllPricingOptions(tierId);
    if (!options || !options.stripe || !options.btcpay) {
        return null;
    }

    const stripePriceFloat = options.stripe.amount / 100;
    const btcpayPriceFloat = options.btcpay.amount / 100;
    const difference = btcpayPriceFloat - stripePriceFloat;
    const percentDifference = ((difference / stripePriceFloat) * 100).toFixed(0);

    return {
        stripe_price: stripePriceFloat,
        btcpay_price: btcpayPriceFloat,
        difference: difference,
        percent_difference: percentDifference,
        btcpay_premium: difference > 0,
        message: difference > 0
            ? `Bitcoin pricing is ${percentDifference}% higher for complete privacy`
            : `Bitcoin pricing is ${Math.abs(percentDifference)}% lower`
    };
}

/**
 * Get default tier for new members
 * @returns {string} Default tier ID
 */
function getDefaultTier() {
    return 'annual_membership';
}

/**
 * Validate that a price_id belongs to a tier
 * @param {string} priceId - Price ID to validate
 * @param {string} provider - Payment provider
 * @returns {string|null} Tier ID if found, null otherwise
 */
function findTierByPriceId(priceId, provider) {
    for (const [tierId, tier] of Object.entries(PRICING_TIERS)) {
        if (tier[provider]?.price_id === priceId && tier[provider]?.enabled) {
            return tierId;
        }
    }
    return null;
}

module.exports = {
    PRICING_TIERS,
    getPricing,
    getAllPricingOptions,
    comparePricing,
    getDefaultTier,
    findTierByPriceId
};

