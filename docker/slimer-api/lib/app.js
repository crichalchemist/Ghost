const express = require('express');
const {execSync} = require('child_process');
const TorrcManager = require('./torrc-manager');

const USERNAME_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Create the slimer hidden-service management Express app.
 *
 * @param {Object} opts
 * @param {string} opts.torrcPath
 * @param {string} opts.hiddenServicesDir
 * @param {string} opts.authSecret
 * @param {boolean} [opts.signalTor=true] - Whether to send SIGHUP to Tor after changes
 * @returns {express.Express}
 */
function createApp({torrcPath, hiddenServicesDir, authSecret, signalTor = true}) {
    const app = express();
    app.use(express.json());

    const manager = new TorrcManager({torrcPath, hiddenServicesDir});

    // Auth middleware (skip for /health)
    app.use((req, res, next) => {
        if (req.path === '/health') {
            return next();
        }

        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${authSecret}`) {
            return res.status(401).json({error: 'unauthorized'});
        }
        next();
    });

    // Health check
    app.get('/health', (_req, res) => {
        res.json({status: 'ok'});
    });

    // Create hidden service
    app.post('/hidden-services', (req, res) => {
        const {username, target, publicKey, secretKey, hostname} = req.body;

        if (!username || !target || !publicKey || !secretKey || !hostname) {
            return res.status(400).json({error: 'missing required fields: username, target, publicKey, secretKey, hostname'});
        }

        if (!USERNAME_REGEX.test(username)) {
            return res.status(400).json({error: 'invalid username: must be lowercase alphanumeric with hyphens, 1-63 chars'});
        }

        try {
            manager.addHiddenService(username, target);
            manager.writeKeys(username, {
                publicKey: Buffer.from(publicKey, 'base64'),
                secretKey: Buffer.from(secretKey, 'base64'),
                hostname
            });

            if (signalTor) {
                _signalTor();
            }

            res.status(201).json({username, hostname});
        } catch (err) {
            if (err.message.includes('already exists')) {
                return res.status(409).json({error: err.message});
            }
            res.status(500).json({error: err.message});
        }
    });

    // Remove hidden service
    app.delete('/hidden-services/:username', (req, res) => {
        const {username} = req.params;

        try {
            manager.removeHiddenService(username);

            if (signalTor) {
                _signalTor();
            }

            res.json({removed: username});
        } catch (err) {
            if (err.message.includes('not found')) {
                return res.status(404).json({error: err.message});
            }
            res.status(500).json({error: err.message});
        }
    });

    // Get hidden service status
    app.get('/hidden-services/:username/status', (req, res) => {
        const {username} = req.params;
        const status = manager.getServiceStatus(username);
        res.json(status);
    });

    return app;
}

/**
 * Send SIGHUP to the Tor process to reload torrc.
 */
function _signalTor() {
    try {
        execSync('pkill -HUP tor', {timeout: 5000});
    } catch {
        // Tor may not be running in dev/test environments
    }
}

module.exports = createApp;
