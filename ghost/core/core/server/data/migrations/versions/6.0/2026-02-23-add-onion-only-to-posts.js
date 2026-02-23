const {createAddColumnMigration} = require('../../utils');

module.exports = createAddColumnMigration('posts', 'onion_only', {
    type: 'boolean',
    nullable: false,
    defaultTo: false
});
