const logging = require('@tryghost/logging');

/**
 * Add access_token column to members_crypto_subscriptions table
 * Enables anonymous Bitcoin subscribers to access content via bearer token URLs
 */
module.exports = {
    config: {
        transaction: true
    },

    async up(knex) {
        logging.info('Adding access_token column to members_crypto_subscriptions table...');

        const hasTable = await knex.schema.hasTable('members_crypto_subscriptions');
        if (!hasTable) {
            logging.warn('Table members_crypto_subscriptions does not exist, skipping migration');
            return;
        }

        const hasColumn = await knex.schema.hasColumn('members_crypto_subscriptions', 'access_token');
        if (!hasColumn) {
            await knex.schema.table('members_crypto_subscriptions', function (table) {
                table.string('access_token', 64).nullable().unique();
            });
            logging.info('Added access_token column to members_crypto_subscriptions');
        } else {
            logging.warn('Column access_token already exists in members_crypto_subscriptions, skipping');
        }
    },

    async down(knex) {
        logging.info('Removing access_token column from members_crypto_subscriptions table...');

        const hasTable = await knex.schema.hasTable('members_crypto_subscriptions');
        if (!hasTable) {
            logging.warn('Table members_crypto_subscriptions does not exist, skipping rollback');
            return;
        }

        const hasColumn = await knex.schema.hasColumn('members_crypto_subscriptions', 'access_token');
        if (hasColumn) {
            await knex.schema.table('members_crypto_subscriptions', function (table) {
                table.dropColumn('access_token');
            });
            logging.info('Removed access_token column from members_crypto_subscriptions');
        } else {
            logging.warn('Column access_token does not exist in members_crypto_subscriptions, skipping');
        }
    }
};
