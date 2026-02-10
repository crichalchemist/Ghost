const logging = require('@tryghost/logging');

/**
 * Add crypto payment tables for BTCPay Server integration
 * Dual payment system: Stripe (existing) + BTCPay (new)
 */
module.exports = {
    config: {
        transaction: true
    },

    async up(knex) {
        logging.info('Adding crypto payment tables for BTCPay integration...');

        // Table 1: Track crypto payment providers per member
        const hasProvidersTable = await knex.schema.hasTable('members_crypto_providers');
        if (!hasProvidersTable) {
            await knex.schema.createTable('members_crypto_providers', function (table) {
                table.string('id', 24).primary();
                table.string('member_id', 24).notNullable();
                table.string('provider', 50).notNullable().defaultTo('btcpay');
                table.string('customer_id', 255); // Provider's customer ID (optional)
                table.text('metadata'); // JSON metadata
                table.dateTime('created_at').notNullable();
                table.dateTime('updated_at').nullable();

                table.foreign('member_id').references('members.id').onDelete('CASCADE');
                table.index('member_id');
                table.index('provider');
            });
            logging.info('Created table: members_crypto_providers');
        }

        // Table 2: Track crypto subscriptions (parallel to Stripe subscriptions)
        const hasSubscriptionsTable = await knex.schema.hasTable('members_crypto_subscriptions');
        if (!hasSubscriptionsTable) {
            await knex.schema.createTable('members_crypto_subscriptions', function (table) {
                table.string('id', 24).primary();
                table.string('member_id', 24).notNullable();
                table.string('provider', 50).notNullable().defaultTo('btcpay');
                table.string('subscription_id', 255); // Provider's subscription ID
                table.string('plan_id', 255).notNullable(); // Ghost tier/product ID
                table.string('status', 50).notNullable().defaultTo('active');
                // Status values: active, past_due, canceled, incomplete, trialing

                // Billing cycle tracking
                table.dateTime('current_period_start').notNullable();
                table.dateTime('current_period_end').notNullable();
                table.boolean('cancel_at_period_end').defaultTo(false);

                // Renewal tracking
                table.boolean('renewal_invoice_sent').defaultTo(false);
                table.string('last_invoice_id', 255).nullable();
                table.dateTime('last_invoice_sent_at').nullable();

                // Pricing
                table.integer('amount').notNullable(); // in cents
                table.string('currency', 10).notNullable().defaultTo('usd');
                table.string('interval', 20).notNullable(); // year, month, etc.

                // Metadata
                table.text('metadata'); // JSON metadata

                // Timestamps
                table.dateTime('created_at').notNullable();
                table.dateTime('updated_at').nullable();

                table.foreign('member_id').references('members.id').onDelete('CASCADE');
                table.index('member_id');
                table.index('status');
                table.index('current_period_end');
                table.index(['provider', 'subscription_id']);
            });
            logging.info('Created table: members_crypto_subscriptions');
        }

        // Table 3: Track individual crypto payment invoices
        const hasInvoicesTable = await knex.schema.hasTable('members_crypto_invoices');
        if (!hasInvoicesTable) {
            await knex.schema.createTable('members_crypto_invoices', function (table) {
                table.string('id', 24).primary();
                table.string('subscription_id', 24).nullable(); // NULL for one-time payments
                table.string('member_id', 24).notNullable(); // Direct member reference
                table.string('provider', 50).notNullable().defaultTo('btcpay');
                table.string('invoice_id', 255).notNullable(); // Provider's invoice ID

                // Amounts
                table.string('amount_crypto', 50).nullable(); // e.g., '0.00123456 BTC'
                table.integer('amount_fiat').notNullable(); // in cents
                table.string('currency', 10).notNullable().defaultTo('usd');

                // Payment details
                table.string('crypto_currency', 10).nullable(); // BTC, ETH, etc.
                table.string('payment_method', 50).nullable(); // bitcoin, lightning, etc.
                table.text('payment_address').nullable(); // Crypto address used
                table.text('transaction_id').nullable(); // Blockchain tx hash

                // Status tracking
                table.string('status', 50).notNullable().defaultTo('pending');
                // Status values: pending, processing, settled, expired, invalid

                // Timestamps
                table.dateTime('created_at').notNullable();
                table.dateTime('paid_at').nullable();
                table.dateTime('expires_at').nullable();

                // Metadata
                table.text('metadata'); // JSON metadata

                table.foreign('subscription_id').references('members_crypto_subscriptions.id').onDelete('SET NULL');
                table.foreign('member_id').references('members.id').onDelete('CASCADE');
                table.index('subscription_id');
                table.index('member_id');
                table.index('invoice_id');
                table.index('status');
                table.index(['provider', 'invoice_id']);
            });
            logging.info('Created table: members_crypto_invoices');
        }

        logging.info('Crypto payment tables created successfully');
    },

    async down(knex) {
        logging.info('Removing crypto payment tables...');

        await knex.schema.dropTableIfExists('members_crypto_invoices');
        await knex.schema.dropTableIfExists('members_crypto_subscriptions');
        await knex.schema.dropTableIfExists('members_crypto_providers');

        logging.info('Crypto payment tables removed');
    }
};

