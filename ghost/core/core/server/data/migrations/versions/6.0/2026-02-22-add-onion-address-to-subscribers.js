const logging = require('@tryghost/logging');
const {createTransactionalMigration} = require('../../utils');

/**
 * Add onion_address column to subscribers table
 * Stores the Tor v3 .onion hostname for subscribers who opt into onion sites
 */
module.exports = createTransactionalMigration(
    async function up(knex) {
        logging.info('Adding onion_address column to subscribers table...');

        const hasTable = await knex.schema.hasTable('subscribers');
        if (!hasTable) {
            logging.warn('Table subscribers does not exist, skipping migration');
            return;
        }

        const hasColumn = await knex.schema.hasColumn('subscribers', 'onion_address');
        if (!hasColumn) {
            await knex.schema.table('subscribers', function (table) {
                table.string('onion_address', 62).nullable();
            });
            logging.info('Added onion_address column to subscribers');
        } else {
            logging.warn('Column onion_address already exists in subscribers, skipping');
        }
    },

    async function down(knex) {
        logging.info('Removing onion_address column from subscribers table...');

        const hasTable = await knex.schema.hasTable('subscribers');
        if (!hasTable) {
            logging.warn('Table subscribers does not exist, skipping rollback');
            return;
        }

        const hasColumn = await knex.schema.hasColumn('subscribers', 'onion_address');
        if (hasColumn) {
            await knex.schema.table('subscribers', function (table) {
                table.dropColumn('onion_address');
            });
            logging.info('Removed onion_address column from subscribers');
        } else {
            logging.warn('Column onion_address does not exist in subscribers, skipping');
        }
    }
);
