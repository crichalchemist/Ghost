const ghostBookshelf = require('./base');

const MemberCryptoSubscription = ghostBookshelf.Model.extend({
    tableName: 'members_crypto_subscriptions',

    member() {
        return this.belongsTo('Member', 'member_id', 'id');
    }
});

module.exports = {
    MemberCryptoSubscription: ghostBookshelf.model('MemberCryptoSubscription', MemberCryptoSubscription)
};
