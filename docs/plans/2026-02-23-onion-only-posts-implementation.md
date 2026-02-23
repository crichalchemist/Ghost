# Onion-Only Posts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let subscribers mark posts as only accessible via .onion, filtered out on clearnet at the model layer.

**Architecture:** Boolean `onion_only` column on posts table. Host detection in `ghost-locals` middleware propagates `isOnionRequest` through context to Post model's `enforcedFilters()`, which adds `onion_only:false` on clearnet requests. Ghost Admin gets a toggle in the post settings sidebar.

**Tech Stack:** Node.js/Express (Ghost backend), Ember.js (Ghost Admin), Knex (migrations), NQL (filtering), Mocha/assert (testing)

---

### Task 1: Database Migration — Add `onion_only` to posts

**Files:**
- Create: `ghost/core/core/server/data/migrations/versions/6.0/2026-02-23-add-onion-only-to-posts.js`
- Modify: `ghost/core/core/server/data/schema/schema.js:98` (add field after `show_title_and_feature_image`)

**Step 1: Create the migration**

```javascript
// ghost/core/core/server/data/migrations/versions/6.0/2026-02-23-add-onion-only-to-posts.js
const logging = require('@tryghost/logging');
const {createTransactionalMigration} = require('../../utils');

module.exports = createTransactionalMigration(
    async function up(knex) {
        logging.info('Adding onion_only column to posts table...');

        const hasTable = await knex.schema.hasTable('posts');
        if (!hasTable) {
            logging.warn('Table posts does not exist, skipping migration');
            return;
        }

        const hasColumn = await knex.schema.hasColumn('posts', 'onion_only');
        if (!hasColumn) {
            await knex.schema.table('posts', function (table) {
                table.boolean('onion_only').notNullable().defaultTo(false);
            });
            logging.info('Added onion_only column to posts');
        } else {
            logging.warn('Column onion_only already exists in posts, skipping');
        }
    },

    async function down(knex) {
        logging.info('Removing onion_only column from posts table...');

        const hasTable = await knex.schema.hasTable('posts');
        if (!hasTable) {
            logging.warn('Table posts does not exist, skipping rollback');
            return;
        }

        const hasColumn = await knex.schema.hasColumn('posts', 'onion_only');
        if (hasColumn) {
            await knex.schema.table('posts', function (table) {
                table.dropColumn('onion_only');
            });
            logging.info('Removed onion_only column from posts');
        }
    }
);
```

**Step 2: Add to schema definition**

In `ghost/core/core/server/data/schema/schema.js`, after line 98 (`show_title_and_feature_image`), add:

```javascript
onion_only: {type: 'boolean', nullable: false, defaultTo: false},
```

**Step 3: Run migration**

Run: `cd ghost/core && yarn knex-migrator migrate`
Expected: "Added onion_only column to posts"

**Step 4: Verify**

Run: `docker exec ghost-mysql mysql -uroot -proot ghost_dev -e "DESCRIBE posts;" 2>/dev/null | grep onion`
Expected: `onion_only	tinyint(1)	NO		0`

**Step 5: Commit**

```bash
git add ghost/core/core/server/data/migrations/versions/6.0/2026-02-23-add-onion-only-to-posts.js ghost/core/core/server/data/schema/schema.js
git commit -m "✨ Added onion_only column to posts table"
```

---

### Task 2: Host Detection Middleware

**Files:**
- Modify: `ghost/core/core/server/web/parent/middleware/ghost-locals.js:18`
- Test: `ghost/core/test/unit/server/web/parent/middleware/ghost-locals.test.js` (create if doesn't exist)

**Step 1: Write the failing test**

```javascript
// ghost/core/test/unit/server/web/parent/middleware/ghost-locals.test.js
const assert = require('node:assert/strict');
const ghostLocals = require('../../../../../../core/server/web/parent/middleware/ghost-locals');

describe('ghost-locals middleware', function () {
    function createReqRes(hostname) {
        return {
            req: {path: '/test', hostname},
            res: {locals: {}},
            next: () => {}
        };
    }

    it('should set isOnionRequest to true for .onion hostnames', function () {
        const {req, res, next} = createReqRes('abcdef1234567890.onion');
        ghostLocals(req, res, next);
        assert.equal(res.locals.isOnionRequest, true);
    });

    it('should set isOnionRequest to false for clearnet hostnames', function () {
        const {req, res, next} = createReqRes('alice.private-stack.dev');
        ghostLocals(req, res, next);
        assert.equal(res.locals.isOnionRequest, false);
    });

    it('should set isOnionRequest to false when hostname is undefined', function () {
        const {req, res, next} = createReqRes(undefined);
        ghostLocals(req, res, next);
        assert.equal(res.locals.isOnionRequest, false);
    });

    it('should still set version and relativeUrl', function () {
        const {req, res, next} = createReqRes('example.com');
        ghostLocals(req, res, next);
        assert.ok(res.locals.version);
        assert.equal(res.locals.relativeUrl, '/test');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ghost/core && npx mocha test/unit/server/web/parent/middleware/ghost-locals.test.js --timeout 10000`
Expected: FAIL — `isOnionRequest` is undefined

**Step 3: Implement**

In `ghost/core/core/server/web/parent/middleware/ghost-locals.js`, after line 18 (`res.locals.relativeUrl = req.path;`), add:

```javascript
// Detect .onion requests for onion-only post filtering
res.locals.isOnionRequest = (req.hostname || '').endsWith('.onion');
```

**Step 4: Run test to verify it passes**

Run: `cd ghost/core && npx mocha test/unit/server/web/parent/middleware/ghost-locals.test.js --timeout 10000`
Expected: 4 passing

**Step 5: Commit**

```bash
git add ghost/core/core/server/web/parent/middleware/ghost-locals.js ghost/core/test/unit/server/web/parent/middleware/ghost-locals.test.js
git commit -m "✨ Added .onion host detection to ghost-locals middleware"
```

---

### Task 3: Context Propagation

**Files:**
- Modify: `ghost/core/core/frontend/services/data/entry-lookup.js:44`
- Modify: `ghost/core/core/frontend/services/data/fetch-data.js:57`

**Step 1: Modify entry-lookup.js**

At line 44, change:

```javascript
options.context = {member: locals.member};
```

To:

```javascript
options.context = {member: locals.member, isOnionRequest: locals.isOnionRequest};
```

**Step 2: Modify fetch-data.js**

At line 57, change:

```javascript
query.options.context = {member: locals.member};
```

To:

```javascript
query.options.context = {member: locals.member, isOnionRequest: locals.isOnionRequest};
```

**Step 3: Commit**

```bash
git add ghost/core/core/frontend/services/data/entry-lookup.js ghost/core/core/frontend/services/data/fetch-data.js
git commit -m "✨ Added isOnionRequest to Content API context propagation"
```

---

### Task 4: Model-Level Filter Enforcement

**Files:**
- Modify: `ghost/core/core/server/models/post.js:1104-1106`
- Test: `ghost/core/test/unit/server/models/post.test.js` (add test cases)

**Step 1: Write the failing test**

Find the existing post model test file and add:

```javascript
describe('enforcedFilters', function () {
    it('should filter onion_only posts on clearnet', function () {
        const Post = require('../../../../core/server/models/post');
        const result = Post.prototype.enforcedFilters.call({}, {
            context: {public: true, isOnionRequest: false}
        });
        assert.equal(result, 'status:published+onion_only:false');
    });

    it('should not filter onion_only posts on .onion requests', function () {
        const Post = require('../../../../core/server/models/post');
        const result = Post.prototype.enforcedFilters.call({}, {
            context: {public: true, isOnionRequest: true}
        });
        assert.equal(result, 'status:published');
    });

    it('should not filter onion_only posts for internal (admin) context', function () {
        const Post = require('../../../../core/server/models/post');
        const result = Post.prototype.enforcedFilters.call({}, {
            context: {internal: true}
        });
        assert.equal(result, null);
    });

    it('should not filter onion_only when isOnionRequest is undefined (default clearnet)', function () {
        const Post = require('../../../../core/server/models/post');
        const result = Post.prototype.enforcedFilters.call({}, {
            context: {public: true}
        });
        assert.equal(result, 'status:published+onion_only:false');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ghost/core && npx mocha test/unit/server/models/post.test.js --grep "enforcedFilters" --timeout 10000`
Expected: FAIL — first test expects `status:published+onion_only:false` but gets `status:published`

**Step 3: Implement**

In `ghost/core/core/server/models/post.js`, replace lines 1104-1106:

```javascript
enforcedFilters: function enforcedFilters(options) {
    return options.context && options.context.public ? 'status:published' : null;
},
```

With:

```javascript
enforcedFilters: function enforcedFilters(options) {
    if (options.context && options.context.public) {
        if (options.context.isOnionRequest) {
            return 'status:published';
        }
        return 'status:published+onion_only:false';
    }
    return null;
},
```

**Step 4: Run test to verify it passes**

Run: `cd ghost/core && npx mocha test/unit/server/models/post.test.js --grep "enforcedFilters" --timeout 10000`
Expected: 4 passing

**Step 5: Commit**

```bash
git add ghost/core/core/server/models/post.js ghost/core/test/unit/server/models/post.test.js
git commit -m "✨ Added onion_only filter enforcement to Post model"
```

---

### Task 5: Ghost Admin — Ember Model

**Files:**
- Modify: `ghost/admin/app/models/post.js:88` (near `featured` attr)

**Step 1: Add attribute**

After `featured: attr('boolean', {defaultValue: false}),` (line 88), add:

```javascript
onionOnly: attr('boolean', {defaultValue: false}),
```

Note: Ember uses camelCase (`onionOnly`). Ghost's serializer auto-converts to/from snake_case (`onion_only`).

**Step 2: Commit**

```bash
git add ghost/admin/app/models/post.js
git commit -m "✨ Added onionOnly attribute to Ember post model"
```

---

### Task 6: Ghost Admin — Toggle Action

**Files:**
- Modify: `ghost/admin/app/components/gh-post-settings-menu.js:222` (after `toggleFeatured`)

**Step 1: Add action handler**

After the `toggleFeatured()` action (around line 222), add:

```javascript
@action
toggleOnionOnly() {
    this.post.onionOnly = !this.post.onionOnly;

    // If this is a new post.  Don't save the post.  Defer the save
    // to the user pressing the save button
    if (this.post.isNew) {
        return;
    }

    this.savePostTask.perform().catch((error) => {
        this.showError(error);
        this.post.rollbackAttributes();
    });
}
```

**Step 2: Commit**

```bash
git add ghost/admin/app/components/gh-post-settings-menu.js
git commit -m "✨ Added toggleOnionOnly action to post settings menu"
```

---

### Task 7: Ghost Admin — Toggle Template

**Files:**
- Modify: `ghost/admin/app/components/gh-post-settings-menu.hbs:180` (after featured toggle `</li>`)

**Step 1: Add toggle HTML**

After line 180 (the closing `{{/unless}}` for the featured toggle), add:

```handlebars
                        <li class="nav-list-item">
                            <div class="for-switch xs">
                                <label class="switch" for="onion-only" {{action "toggleOnionOnly" bubbles="false"}}>
                                    <span>
                                        {{#if this.post.onionOnly}}
                                            {{svg-jar "lock-fill" class="feature"}}
                                        {{else}}
                                            {{svg-jar "lock" class="feature"}}
                                        {{/if}}
                                        Onion-only {{this.post.displayName}}
                                    </span>
                                    <span class="gh-toggle-featured">
                                        <input
                                            type="checkbox"
                                            checked={{this.post.onionOnly}}
                                            class="gh-input post-settings-featured gh-input-x"
                                            onclick={{action (mut this.post.onionOnly) value="target.checked"}}
                                            data-test-checkbox="onion-only"
                                        >
                                        <span class="input-toggle-component"></span>
                                    </span>
                                </label>
                            </div>
                        </li>
```

Note: Uses `svg-jar "lock"` / `svg-jar "lock-fill"` icons — check `ghost/admin/public/assets/icons/` for available SVG icons. If `lock` isn't available, use `eye` or another suitable icon from the existing set.

**Step 2: Verify available icons**

Run: `ls ghost/admin/public/assets/icons/ | grep -i lock`
If no lock icon exists, substitute with an available one.

**Step 3: Commit**

```bash
git add ghost/admin/app/components/gh-post-settings-menu.hbs
git commit -m "✨ Added onion-only toggle to post settings sidebar"
```

---

### Task 8: API Serializer — Keep `onion_only` in Output

**Files:**
- Modify: `ghost/core/core/server/api/endpoints/utils/serializers/output/utils/clean.js:137`

**Step 1: Check current behavior**

The `clean.js` serializer explicitly deletes certain fields. The `onion_only` field is a standard column, so it should pass through automatically. BUT if it doesn't appear in API responses, add it explicitly.

Test by starting Ghost and hitting the Admin API:

```bash
curl -s http://localhost:2368/ghost/api/admin/posts/?limit=1 \
  -H "Authorization: Ghost <admin-api-token>" | python3 -c "
import sys, json
post = json.load(sys.stdin)['posts'][0]
print('onion_only' in post, post.get('onion_only'))
"
```

If `onion_only` is NOT present, check if `clean.js` deletes it. If so, ensure it's NOT listed in the deletion block (lines 137-141).

**Step 2: Commit if changes needed**

```bash
git add ghost/core/core/server/api/endpoints/utils/serializers/output/utils/clean.js
git commit -m "🐛 Ensured onion_only field passes through API serializer"
```

---

### Task 9: Integration Test — End-to-End Verification

**Files:**
- Test: `ghost/core/test/unit/server/services/subscriber-provisioning/onion-only-filter.test.js`

**Step 1: Write integration test**

```javascript
const assert = require('node:assert/strict');

describe('Onion-Only Post Filtering', function () {
    it('enforcedFilters adds onion_only:false for clearnet requests', function () {
        const Post = require('../../../../core/server/models/post');
        const filter = Post.prototype.enforcedFilters.call({}, {
            context: {public: true, isOnionRequest: false}
        });
        assert.ok(filter.includes('onion_only:false'));
    });

    it('enforcedFilters does NOT add onion_only filter for .onion requests', function () {
        const Post = require('../../../../core/server/models/post');
        const filter = Post.prototype.enforcedFilters.call({}, {
            context: {public: true, isOnionRequest: true}
        });
        assert.ok(!filter.includes('onion_only'));
    });

    it('ghost-locals sets isOnionRequest correctly', function () {
        const ghostLocals = require('../../../../core/server/web/parent/middleware/ghost-locals');
        const res = {locals: {}};
        ghostLocals({path: '/', hostname: 'abc123.onion'}, res, () => {});
        assert.equal(res.locals.isOnionRequest, true);

        const res2 = {locals: {}};
        ghostLocals({path: '/', hostname: 'alice.private-stack.dev'}, res2, () => {});
        assert.equal(res2.locals.isOnionRequest, false);
    });
});
```

**Step 2: Run all tests**

Run: `cd ghost/core && npx mocha test/unit/server/services/subscriber-provisioning/ --recursive --timeout 10000`
Expected: All passing

**Step 3: Commit**

```bash
git add ghost/core/test/unit/server/services/subscriber-provisioning/onion-only-filter.test.js
git commit -m "Added onion-only post filtering integration tests"
```

---

### Task 10: Push and Verify

**Step 1: Run full test suite**

Run: `cd ghost/core && npx mocha test/unit/server/services/subscriber-provisioning/ --recursive --timeout 10000 && npx mocha test/unit/server/web/parent/middleware/ghost-locals.test.js --timeout 10000`
Expected: All passing

**Step 2: Push**

```bash
git push
```
