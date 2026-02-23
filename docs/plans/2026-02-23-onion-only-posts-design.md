# Onion-Only Posts Design

**Goal:** Let subscribers mark individual posts as only accessible via their .onion address, invisible on clearnet.

**Architecture:** Model-level NQL filter checks request origin (Host header). Posts with `onion_only:true` are excluded from all public queries when the request arrives via clearnet. Ghost Admin gets a toggle in the post settings sidebar.

---

## Data Layer

New column on `posts` table:

```sql
ALTER TABLE posts ADD COLUMN onion_only BOOLEAN DEFAULT FALSE NOT NULL;
```

Migration follows Ghost's `createTransactionalMigration` pattern with `hasTable`/`hasColumn` guards.

## Host Detection

`ghost/core/core/server/web/parent/middleware/ghost-locals.js` sets `res.locals.isOnionRequest` based on `req.hostname`:

```js
res.locals.isOnionRequest = (req.hostname || '').endsWith('.onion');
```

This runs early in the middleware pipeline. The value propagates through existing `locals` objects passed to the Content API.

## Context Propagation

Two files pass `locals` into API options:

- `ghost/core/core/frontend/services/data/entry-lookup.js:44`
- `ghost/core/core/frontend/services/data/fetch-data.js:57`

Both currently set `options.context = {member: locals.member}`. Extended to:

```js
options.context = {member: locals.member, isOnionRequest: locals.isOnionRequest};
```

## Model Enforcement

`ghost/core/core/server/models/post.js` — `enforcedFilters()` method. Currently returns `'status:published'` for public context. Updated to also filter `onion_only` on clearnet:

```js
enforcedFilters: function(options) {
    if (options.context && options.context.public) {
        if (options.context.isOnionRequest) {
            return 'status:published';
        }
        return 'status:published+onion_only:false';
    }
    return null;
}
```

This single enforcement point covers: collections, single post pages, RSS feeds, Content API, sitemaps. Admin API is unaffected (uses internal context, not public).

## Schema Registration

`ghost/core/core/server/data/schema/schema.js` — add `onion_only` to the posts table definition so Ghost's schema validator recognizes it.

## API Serialization

The posts API input/output serializers need to allow `onion_only` as a valid field so subscribers can set it via the Admin API.

## Ghost Admin UI

Three files:

**Model** (`ghost/admin/app/models/post.js`):
```js
onionOnly: attr('boolean', {defaultValue: false}),
```

**Component logic** (`ghost/admin/app/components/gh-post-settings-menu.js`):
```js
@action
toggleOnionOnly() {
    this.post.onionOnly = !this.post.onionOnly;
    if (this.post.isNew) return;
    this.savePostTask.perform().catch((error) => {
        this.showError(error);
        this.post.rollbackAttributes();
    });
}
```

**Template** (`ghost/admin/app/components/gh-post-settings-menu.hbs`):
Toggle checkbox after the "Feature this post" toggle, following the same HTML pattern. Uses a lock or onion icon.

## What's Out of Scope

- Per-subscriber config gating (toggle visible for all instances)
- Custom theme helpers (themes render normally; filtering is pre-theme)
- RSS/sitemap special handling (model filter covers these automatically)
- Content API v2 changes (v2 is deprecated, only v3+ matters)

## Verification

1. Create post with `onion_only: true` via Admin API
2. Request post via clearnet hostname — expect 404
3. Request same post via .onion hostname — expect 200
4. Check collection pages on clearnet — onion-only posts absent
5. Check RSS feed on clearnet — onion-only posts absent
6. Check Ghost Admin — post fully visible and editable regardless
