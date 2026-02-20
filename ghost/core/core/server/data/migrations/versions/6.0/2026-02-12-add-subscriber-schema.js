const logging = require('@tryghost/logging');
const {createTransactionalMigration} = require('../../utils');

module.exports = createTransactionalMigration(
    async function up(knex) {
        logging.info('Adding subscriber container management tables...');

        // Subscribers table - tracks which members have containers
        const hasSubscribersTable = await knex.schema.hasTable('subscribers');
        if (!hasSubscribersTable) {
            await knex.schema.createTable('subscribers', function(table) {
                table.string('id', 24).primary();
                table.string('member_id', 24).notNullable();
                table.string('username', 100).notNullable().unique(); // For subdomain: username.private-stack.dev
                table.string('custom_domain', 255).nullable();
                table.string('container_id', 64).nullable(); // Docker container ID
                table.integer('port').notNullable();
                table.string('status', 50).defaultTo('provisioning'); // provisioning, running, stopped, error
                table.text('metadata').nullable();
                table.dateTime('created_at').notNullable();
                table.dateTime('updated_at').nullable();
                table.dateTime('deleted_at').nullable();

                table.foreign('member_id').references('members.id').onDelete('CASCADE');
                table.index('member_id');
                table.index('username');
                table.index('status');
            });
            logging.info('Created table: subscribers');
        }

        // Container events log
        const hasEventsTable = await knex.schema.hasTable('subscriber_container_events');
        if (!hasEventsTable) {
            await knex.schema.createTable('subscriber_container_events', function(table) {
                table.increments('id').primary();
                table.string('subscriber_id', 24).notNullable();
                table.string('event_type', 50).notNullable(); // created, started, stopped, error, deleted
                table.text('details').nullable();
                table.dateTime('created_at').notNullable();

                table.foreign('subscriber_id').references('subscribers.id').onDelete('CASCADE');
                table.index('subscriber_id');
                table.index('event_type');
            });
            logging.info('Created table: subscriber_container_events');
        }

        logging.info('Subscriber schema tables created successfully');
    },

    async function down(knex) {
        logging.info('Removing subscriber container management tables...');

        await knex.schema.dropTableIfExists('subscriber_container_events');
        await knex.schema.dropTableIfExists('subscribers');

        logging.info('Subscriber schema tables removed');
    }
);
