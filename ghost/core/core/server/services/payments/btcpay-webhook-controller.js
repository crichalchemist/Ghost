const logging = require('@tryghost/logging');
const crypto = require('crypto');

/**
 * BTCPay Webhook Controller
 * Handles webhook events from BTCPay Server
 */
class BTCPayWebhookController {
    constructor(deps) {
        this.paymentService = deps.paymentService;
        this.memberRepository = deps.memberRepository;
        this.labs = deps.labs;
    }

    /**
     * Main webhook handler
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async handle(req, res) {
        try {
            // Parse and verify webhook
            const event = await this.paymentService.handleWebhook('btcpay', req);

            logging.info(`BTCPay webhook received: ${event.type}`);

            // Route to appropriate handler
            switch (event.type) {
            case 'InvoiceCreated':
                await this._handleInvoiceCreated(event);
                break;
            case 'InvoiceReceivedPayment':
                await this._handleInvoiceReceivedPayment(event);
                break;
            case 'InvoiceProcessing':
                await this._handleInvoiceProcessing(event);
                break;
            case 'InvoiceSettled':
                await this._handleInvoiceSettled(event);
                break;
            case 'InvoiceExpired':
                await this._handleInvoiceExpired(event);
                break;
            case 'InvoiceInvalid':
                await this._handleInvoiceInvalid(event);
                break;
            default:
                logging.warn(`Unhandled BTCPay webhook event: ${event.type}`);
            }

            res.status(200).json({received: true});
        } catch (error) {
            logging.error('BTCPay webhook processing error:', error);
            res.status(400).json({error: error.message});
        }
    }

    async _handleInvoiceCreated(event) {
        logging.info('Invoice created:', event.invoiceId);
        // Just log for now - no action needed at creation
    }

    async _handleInvoiceReceivedPayment(event) {
        logging.info('Invoice received payment:', event.invoiceId);
        // Payment detected but not yet confirmed
        // Wait for InvoiceSettled for final confirmation
    }

    async _handleInvoiceProcessing(event) {
        logging.info('Invoice processing:', event.invoiceId);
        // Payment is being processed (confirming on blockchain)
    }

    /**
     * Handle successful payment - most important event!
     * @param {Object} event - BTCPay webhook event
     */
    async _handleInvoiceSettled(event) {
        const invoice = event;
        const metadata = invoice.metadata || {};

        logging.info(`Invoice settled: ${invoice.id}`, metadata);

        try {
            if (metadata.ghost_subscription && metadata.ghost_annual_membership) {
                // New annual subscription
                await this._createSubscription(invoice, metadata);
            } else if (metadata.renewal) {
                // Subscription renewal
                await this._renewSubscription(invoice, metadata);
            } else if (metadata.ghost_one_time_payment) {
                // One-time payment (donation, tip, etc.)
                await this._recordOneTimePayment(invoice, metadata);
            }
        } catch (error) {
            logging.error('Error processing settled invoice:', error);
            throw error;
        }
    }

    async _handleInvoiceExpired(event) {
        const invoice = event;
        const metadata = invoice.metadata || {};

        logging.info(`Invoice expired: ${invoice.id}`);

        if (metadata.renewal && metadata.subscription_id) {
            // Renewal payment expired - mark subscription as past_due
            await this._markSubscriptionPastDue(metadata.subscription_id);
        }
    }

    async _handleInvoiceInvalid(event) {
        logging.error(`Invoice invalid: ${event.invoiceId}`);
        // Handle invalid payment
    }

    /**
     * Create new subscription from settled invoice
     * @param {Object} invoice - BTCPay invoice object
     * @param {Object} metadata - Invoice metadata
     */
    async _createSubscription(invoice, metadata) {
        const knex = require('../../data/db/connection');
        const {memberEmail, memberId, priceId} = metadata;

        // Find or create member
        let member;
        if (memberId) {
            member = await this.memberRepository.get({id: memberId});
        }

        if (!member) {
            member = await this.memberRepository.get({email: memberEmail});
        }

        if (!member) {
            // Create new member
            member = await this.memberRepository.create({
                email: memberEmail,
                status: 'paid',
                email_suppression: {
                    suppressed: false
                }
            });
        }

        // Calculate period dates (annual)
        const currentPeriodStart = new Date();
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);

        // Generate access token for anonymous subscriptions (no email)
        const accessToken = memberEmail ? null : crypto.randomBytes(32).toString('hex');

        // Create subscription record
        const subscriptionId = crypto.randomUUID();
        await knex('members_crypto_subscriptions').insert({
            id: subscriptionId,
            member_id: member.id,
            provider: 'btcpay',
            subscription_id: invoice.id, // Use invoice ID as subscription ID
            plan_id: priceId || 'annual_membership',
            status: 'active',
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: false,
            renewal_invoice_sent: false,
            amount: 3000, // $30 in cents
            currency: 'usd',
            interval: 'year',
            metadata: JSON.stringify(metadata),
            access_token: accessToken,
            created_at: new Date(),
            updated_at: new Date()
        });

        // Create invoice record
        await this._createInvoiceRecord(invoice, subscriptionId, member.id);

        // Update member status to paid
        await this.memberRepository.update({
            id: member.id
        }, {
            status: 'paid'
        });

        logging.info(`Created Bitcoin subscription for member: ${member.email}`);
    }

    /**
     * Renew existing subscription
     * @param {Object} invoice - BTCPay invoice object
     * @param {Object} metadata - Invoice metadata
     */
    async _renewSubscription(invoice, metadata) {
        const knex = require('../../data/db/connection');
        const {subscription_id: subscriptionId} = metadata;

        const subscription = await knex('members_crypto_subscriptions')
            .where('id', subscriptionId)
            .first();

        if (!subscription) {
            logging.error(`Subscription not found for renewal: ${subscriptionId}`);
            return;
        }

        // Calculate new period
        const newPeriodStart = new Date(subscription.current_period_end);
        const newPeriodEnd = new Date(newPeriodStart);
        newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);

        // Update subscription
        await knex('members_crypto_subscriptions')
            .where('id', subscriptionId)
            .update({
                current_period_start: newPeriodStart,
                current_period_end: newPeriodEnd,
                renewal_invoice_sent: false,
                status: 'active',
                updated_at: new Date()
            });

        // Create invoice record
        await this._createInvoiceRecord(invoice, subscriptionId, subscription.member_id);

        logging.info(`Renewed Bitcoin subscription: ${subscriptionId}`);
    }

    /**
     * Record one-time payment
     * @param {Object} invoice - BTCPay invoice object
     * @param {Object} metadata - Invoice metadata
     */
    async _recordOneTimePayment(invoice, metadata) {
        const {memberEmail} = metadata;

        // Find or create member
        let member = await this.memberRepository.get({email: memberEmail});
        if (!member) {
            member = await this.memberRepository.create({
                email: memberEmail,
                status: 'free' // One-time payment doesn't grant paid status
            });
        }

        // Create invoice record (no subscription)
        await this._createInvoiceRecord(invoice, null, member.id);

        logging.info(`Recorded one-time Bitcoin payment for: ${memberEmail}`);
    }

    /**
     * Create invoice record in database
     * @param {Object} invoice - BTCPay invoice object
     * @param {string|null} subscriptionId - Ghost subscription ID (null for one-time payments)
     * @param {string} memberId - Ghost member ID
     */
    async _createInvoiceRecord(invoice, subscriptionId, memberId) {
        const knex = require('../../data/db/connection');

        await knex('members_crypto_invoices').insert({
            id: require('crypto').randomUUID(),
            subscription_id: subscriptionId,
            member_id: memberId,
            provider: 'btcpay',
            invoice_id: invoice.id,
            amount_crypto: this._extractCryptoAmount(invoice),
            amount_fiat: Math.round(parseFloat(invoice.amount) * 100), // Convert to cents
            currency: invoice.currency.toLowerCase(),
            crypto_currency: this._extractCryptoCurrency(invoice),
            payment_method: this._extractPaymentMethod(invoice),
            payment_address: this._extractPaymentAddress(invoice),
            transaction_id: this._extractTransactionId(invoice),
            status: 'settled',
            created_at: new Date(invoice.createdTime * 1000),
            paid_at: new Date(),
            metadata: JSON.stringify(invoice.metadata || {})
        });
    }

    /**
     * Mark subscription as past_due when renewal fails
     * @param {string} subscriptionId - Ghost subscription ID
     */
    async _markSubscriptionPastDue(subscriptionId) {
        const knex = require('../../data/db/connection');

        await knex('members_crypto_subscriptions')
            .where('id', subscriptionId)
            .update({
                status: 'past_due',
                updated_at: new Date()
            });

        logging.warn(`Subscription marked as past_due: ${subscriptionId}`);

        // TODO: Send email notification to member
    }

    // Helper methods to extract payment details from BTCPay invoice

    _extractCryptoAmount(invoice) {
        // Extract crypto amount from payment details
        if (invoice.amount && invoice.cryptoPaid) {
            return invoice.cryptoPaid;
        }
        return null;
    }

    _extractCryptoCurrency(invoice) {
        // Extract cryptocurrency type (BTC, LTC, etc.)
        if (invoice.checkout?.paymentMethod) {
            return invoice.checkout.paymentMethod.toUpperCase();
        }
        return 'BTC'; // Default to Bitcoin
    }

    _extractPaymentMethod(invoice) {
        // bitcoin or lightning
        if (invoice.checkout?.paymentMethod?.includes('lightning')) {
            return 'lightning';
        }
        return 'bitcoin';
    }

    _extractPaymentAddress(invoice) {
        // Extract crypto address if available
        return invoice.cryptoCode || null;
    }

    _extractTransactionId(invoice) {
        // Extract blockchain transaction ID if available
        return invoice.transactionId || null;
    }
}

module.exports = BTCPayWebhookController;

