#!/usr/bin/env node

/**
 * Ghost Subscriber Management CLI
 *
 * Usage:
 *   node bin/manage-subscribers.js create --email=user@example.com --username=username
 *   node bin/manage-subscribers.js list
 *   node bin/manage-subscribers.js delete --username=username
 */

const path = require('path');
const SubscriberManagementCLI = require('../core/server/cli/subscriber-management');

// Parse command line arguments
function parseArgs(args) {
    const parsed = {
        command: args[0],
        options: {}
    };

    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const [key, value] = arg.substring(2).split('=');
            parsed.options[key] = value;
        }
    }

    return parsed;
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        new SubscriberManagementCLI().help();
        process.exit(0);
    }

    const {command, options} = parseArgs(args);
    const config = {};
    if (options.provider) {
        config.provider = options.provider;
    }
    const cli = new SubscriberManagementCLI(config);

    try {
        switch (command) {
        case 'create':
            if (!options.email || !options.username) {
                console.error('✗ Error: --email and --username are required for create command');
                process.exit(1);
            }
            await cli.create({
                email: options.email,
                username: options.username,
                customDomain: options['custom-domain'] || null
            });
            break;

        case 'list':
            await cli.list();
            break;

        case 'delete':
            if (!options.username) {
                console.error('✗ Error: --username is required for delete command');
                process.exit(1);
            }
            await cli.delete({
                username: options.username
            });
            break;

        case 'help':
            await cli.help();
            break;

        default:
            console.error(`✗ Unknown command: ${command}`);
            await cli.help();
            process.exit(1);
        }
    } catch (error) {
        console.error('✗ CLI Error:', error.message);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('✗ Fatal error:', err);
    process.exit(1);
});
