# Ghost Workspace Initialization Status

**Date:** February 9, 2026  
**Status:** ✅ COMPLETE

## System Requirements Verified

- ✅ **Node.js**: v22.22.0
- ✅ **Yarn**: v1.22.22
- ✅ **Docker**: v28.3.3
- ✅ **Docker Compose**: v1.29.2
- ✅ **Nx**: v22.0.4 (local)

## Initialization Steps Completed

### 1. Dependencies Installation ✅
- All workspace dependencies installed via `yarn install`
- Root `node_modules/` directory created
- All workspace packages (`ghost/*`, `apps/*`, `e2e/`) have dependencies

### 2. Git Submodules ✅
- Casper theme: `ghost/core/content/themes/casper`
- Source theme: `ghost/core/content/themes/source`

### 3. Environment Configuration ✅
- `.env` file created from `.env.example`
- Ready for customization with:
  - Docker Compose profiles
  - Debug levels
  - App flags
  - Stripe keys (optional)

### 4. Workspace Structure ✅
```
Ghost/
├── ghost/*           - Core Ghost packages
│   ├── core/        - Main Ghost application (Node.js/Express)
│   ├── admin/       - Ember.js admin client (legacy)
│   ├── i18n/        - Internationalization
│   └── parse-email-address/
├── apps/*           - React-based UI applications
│   ├── admin-x-*    - Admin apps (settings, activitypub, etc.)
│   ├── posts/       - Post analytics
│   ├── stats/       - Site-wide analytics
│   ├── portal/      - Public member portal
│   ├── comments-ui/ - Comments system
│   ├── signup-form/ - Signup form
│   ├── sodo-search/ - Search functionality
│   └── announcement-bar/
└── e2e/             - End-to-end tests (Playwright)
```

## Next Steps - Quick Start

### Development (Recommended - Docker-based)
```bash
yarn dev                      # Start Ghost with Docker + frontend dev servers
```

This will:
- Start MySQL, Redis, and other services in Docker
- Run Ghost backend in a container
- Start frontend dev servers on your host machine for hot reload

### Alternative: Legacy Development (Local)
```bash
yarn dev:legacy              # Start Ghost locally (deprecated)
yarn dev:legacy:debug        # With debug logging enabled
```

### Building
```bash
yarn build                   # Build all packages
yarn build:clean             # Clean build artifacts and rebuild
```

### Testing
```bash
yarn test:unit               # Run all unit tests
yarn test:e2e                # Run E2E tests
cd ghost/core && yarn test:all  # Run all Ghost core tests
```

### Database Management
```bash
yarn knex-migrator migrate   # Run database migrations
yarn reset:data              # Reset DB with test data (1000 members, 100 posts)
yarn reset:data:empty        # Reset DB with no data
```

### Docker Commands
```bash
yarn docker:shell            # Open shell in Ghost container
yarn docker:mysql            # Open MySQL CLI
yarn docker:reset            # Reset all Docker volumes and restart
yarn docker:clean            # Delete all node_modules volumes
```

## Development Tips

1. **First time running Ghost?**
   - Run `yarn dev` (Docker-based development)
   - Ghost will be available at: http://localhost:2368
   - Admin interface at: http://localhost:2368/ghost

2. **Working on frontend apps?**
   - Apps in `apps/*` have hot reload enabled in dev mode
   - Changes will automatically rebuild

3. **Need to debug?**
   - Use `yarn dev:legacy:debug` for detailed logging
   - Or set `DEBUG=@tryghost*,ghost:*` in your `.env` file

4. **Database issues?**
   - Run `yarn reset:data` to start fresh with test data
   - Or `yarn docker:reset` to completely reset Docker environment

## Useful Documentation

- **Main docs**: See `AGENTS.md` and `CLAUDE.md` in the root
- **E2E tests**: See `e2e/CLAUDE.md` and `e2e/AGENTS.md`
- **ADRs**: Architecture decision records in `adr/`
- **Contributing**: `.github/CONTRIBUTING.md`

## Environment Variables

The `.env` file supports:
- `COMPOSE_PROFILES` - Docker Compose profiles to enable (e.g., `stripe`, `analytics`)
- `DEBUG` - Debug log levels
- `GHOST_DEV_APP_FLAGS` - Flags for dev command
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_ACCOUNT_ID` - Stripe integration

## Status Summary

🎉 **The Ghost monorepo is fully initialized and ready for development!**

Run `yarn dev` to start developing.

