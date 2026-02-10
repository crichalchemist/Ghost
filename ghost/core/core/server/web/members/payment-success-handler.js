const errors = require('@tryghost/errors');
const tpl = require('@tryghost/tpl');

const messages = {
    invalidInvoice: 'Invalid or not found invoice ID',
    paymentPending: 'Payment is still being processed'
};

/**
 * Handle payment success redirects from BTCPay Server
 * Shows access token for anonymous subscriptions or success message for email-based
 */
async function handlePaymentSuccess(req, res, next) {
    const {invoiceId} = req.query;
    
    if (!invoiceId) {
        return next(new errors.BadRequestError({
            message: tpl(messages.invalidInvoice)
        }));
    }
    
    try {
        const knex = require('../../data/db/connection');
        
        // Find subscription by invoice ID
        const subscription = await knex('members_crypto_subscriptions')
            .where('subscription_id', invoiceId)
            .first();
        
        if (!subscription) {
            return next(new errors.NotFoundError({
                message: tpl(messages.invalidInvoice)
            }));
        }
        
        // Check if payment is settled
        if (subscription.status !== 'active') {
            return res.status(202).json({
                success: false,
                status: subscription.status,
                message: tpl(messages.paymentPending)
            });
        }
        
        // Get member details
        const member = await knex('members')
            .where('id', subscription.member_id)
            .first();
        
        // Return different response based on whether subscription is anonymous
        if (subscription.access_token) {
            // Anonymous subscription - return access token
            return res.json({
                success: true,
                anonymous: true,
                accessToken: subscription.access_token,
                accessUrl: `${req.protocol}://${req.get('host')}/members/access/${subscription.access_token}`,
                subscription: {
                    status: subscription.status,
                    currentPeriodEnd: subscription.current_period_end
                }
            });
        } else {
            // Email-based subscription - return success with email
            return res.json({
                success: true,
                anonymous: false,
                email: member.email,
                subscription: {
                    status: subscription.status,
                    currentPeriodEnd: subscription.current_period_end
                }
            });
        }
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    handlePaymentSuccess
};
