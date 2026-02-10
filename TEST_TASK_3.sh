#!/bin/bash

# Task 3: Bearer Token Access Route - Testing Script
# Run this script to test the implementation

set -e

echo "========================================"
echo "Task 3: Testing Bearer Token Access Route"
echo "========================================"
echo ""

# Change to Ghost core directory
cd /Volumes/Containers/Ghost/ghost/core

echo "Step 1: Running Unit Tests..."
echo "----------------------------------------"
yarn test:unit test/unit/server/web/members/access-token-auth.test.js

echo ""
echo "✅ All unit tests passed!"
echo ""

echo "Step 2: Checking if Ghost models load correctly..."
echo "----------------------------------------"
node -e "
  const models = require('./core/server/models');
  models.init();
  console.log('✅ MemberCryptoSubscription model:', models.MemberCryptoSubscription ? 'Found' : 'Not found');
"

echo ""
echo "========================================"
echo "✅ Task 3 Tests Complete!"
echo "========================================"
echo ""
echo "Next Steps:"
echo "1. Start Ghost: yarn dev"
echo "2. Create test data (see TASK_3_IMPLEMENTATION.md)"
echo "3. Visit: http://localhost:2368/members/access/[your-token]"
echo ""
