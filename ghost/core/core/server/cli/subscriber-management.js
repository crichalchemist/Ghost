const logging = require('@tryghost/logging');
const SubscriberProvisioningService = require('../services/subscriber-provisioning');

class SubscriberManagementCLI {
    constructor() {
        this.provisioner = new SubscriberProvisioningService();
    }

    async create({email, username, customDomain}) {
        try {
            const result = await this.provisioner.provisionSubscriber({
                email,
                username,
                custom_domain: customDomain
            });
            console.log(`✓ Created subscriber container`);
            console.log(`  Username: ${username}`);
            console.log(`  Email: ${email}`);
            console.log(`  URL: ${result.url}`);
            console.log(`  Port: ${result.port}`);
            if (customDomain) {
                console.log(`  Custom Domain: ${customDomain}`);
            }
        } catch (error) {
            console.error(`✗ Failed to create subscriber:`, error.message);
            process.exit(1);
        }
    }

    async list() {
        try {
            const knex = require('../../data/db/connection');

            const subscribers = await knex('subscribers')
                .select('*')
                .orderBy('created_at', 'desc');

            if (subscribers.length === 0) {
                console.log('No subscribers found');
                return;
            }

            console.log(`\nFound ${subscribers.length} subscriber(s):\n`);
            console.log('Username'.padEnd(20) + 'Status'.padEnd(15) + 'Port'.padEnd(8) + 'URL');
            console.log('-'.repeat(70));

            subscribers.forEach(sub => {
                const url = `https://${sub.username}.private-stack.dev`;
                console.log(
                    sub.username.padEnd(20) +
                    (sub.status || 'unknown').padEnd(15) +
                    (sub.port || '-').toString().padEnd(8) +
                    url
                );
            });
            console.log('');
        } catch (error) {
            console.error(`✗ Failed to list subscribers:`, error.message);
            process.exit(1);
        }
    }

    async delete({username}) {
        try {
            await this.provisioner.deprovisionSubscriber(username);
            console.log(`✓ Deleted subscriber container: ${username}`);
        } catch (error) {
            console.error(`✗ Failed to delete subscriber:`, error.message);
            process.exit(1);
        }
    }

    async help() {
        console.log(`
Ghost Subscriber Management CLI

Usage:
  node bin/manage-subscribers.js create --email=user@example.com --username=username [--custom-domain=domain.com]
  node bin/manage-subscribers.js list
  node bin/manage-subscribers.js delete --username=username

Commands:
  create    Create a new subscriber container
  list      List all subscriber containers
  delete    Delete a subscriber container
  help      Show this help message

Options:
  --email=EMAIL              Email address for the subscriber (required for create)
  --username=USERNAME        Subdomain username (required for create/delete)
  --custom-domain=DOMAIN     Custom domain for the subscriber (optional)

Examples:
  node bin/manage-subscribers.js create --email=john@example.com --username=john
  node bin/manage-subscribers.js create --email=jane@example.com --username=jane --custom-domain=jane.com
  node bin/manage-subscribers.js list
  node bin/manage-subscribers.js delete --username=john
        `);
    }
}

module.exports = SubscriberManagementCLI;
