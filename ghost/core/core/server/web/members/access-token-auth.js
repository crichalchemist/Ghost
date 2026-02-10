const errors = require('@tryghost/errors');
const tpl = require('@tryghost/tpl');

const messages = {
    invalidToken: 'Invalid or expired access token',
    expiredSubscription: 'This subscription has expired'
};

/**
 * Authenticates a member using a bearer token from the URL
 * Sets an httpOnly cookie and redirects to homepage
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next middleware function
 * @param {object} MemberCryptoSubscription - The model to query
 */
async function authenticate(req, res, next, MemberCryptoSubscription) {
    const {token} = req.params;

    // Validate token format (must be 64 characters - hex string)
    if (!token || token.length !== 64) {
        return next(new errors.UnauthorizedError({
            message: tpl(messages.invalidToken)
        }));
    }

    try {
        // Find subscription by access token
        const subscription = await MemberCryptoSubscription.findOne({
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

        // Get the related member
        const member = subscription.related('member');

        // Set authentication cookie
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
        };

        res.cookie('ghost-members-ssr', JSON.stringify({
            memberId: member.get('id'),
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
