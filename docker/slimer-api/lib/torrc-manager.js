const fs = require('fs');
const path = require('path');

class TorrcManager {
    /**
     * @param {Object} opts
     * @param {string} opts.torrcPath - Absolute path to the torrc file
     * @param {string} opts.hiddenServicesDir - Base directory for hidden service directories
     */
    constructor({torrcPath, hiddenServicesDir}) {
        this.torrcPath = torrcPath;
        this.hiddenServicesDir = hiddenServicesDir;
    }

    /**
     * Parse the torrc file and extract hidden service entries.
     * Each entry starts with HiddenServiceDir and is followed by one or more HiddenServicePort lines.
     *
     * @returns {Array<{dir: string, ports: Array<{virtual: number, target: string}>}>}
     */
    parseTorrc() {
        const content = fs.readFileSync(this.torrcPath, 'utf8');
        const lines = content.split('\n');
        const services = [];
        let current = null;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('HiddenServiceDir ')) {
                if (current) {
                    services.push(current);
                }
                current = {
                    dir: trimmed.replace('HiddenServiceDir ', '').trim(),
                    ports: []
                };
            } else if (trimmed.startsWith('HiddenServicePort ') && current) {
                const parts = trimmed.replace('HiddenServicePort ', '').trim().split(/\s+/);
                current.ports.push({
                    virtual: parseInt(parts[0], 10),
                    target: parts[1]
                });
            }
        }

        if (current) {
            services.push(current);
        }

        return services;
    }

    /**
     * Get the directory name for a subscriber's hidden service.
     * @param {string} username
     * @returns {string}
     */
    _serviceDir(username) {
        return path.join(this.hiddenServicesDir, `ghost-sub-${username}`);
    }

    /**
     * Add a hidden service entry to the torrc and create its directory.
     *
     * @param {string} username - Subscriber username
     * @param {string} target - Target address (e.g. "10.0.0.4:2368")
     */
    addHiddenService(username, target) {
        const serviceDir = this._serviceDir(username);
        const services = this.parseTorrc();

        // Check for duplicates
        if (services.some(s => s.dir === serviceDir)) {
            throw new Error(`Hidden service for '${username}' already exists`);
        }

        // Create directory with Tor-required permissions (0700)
        fs.mkdirSync(serviceDir, {mode: 0o700, recursive: true});

        // Append to torrc
        const content = fs.readFileSync(this.torrcPath, 'utf8');
        const entry = `\nHiddenServiceDir ${serviceDir}\nHiddenServicePort 80 ${target}\n`;
        fs.writeFileSync(this.torrcPath, content + entry);
    }

    /**
     * Remove a hidden service entry from the torrc and delete its directory.
     *
     * @param {string} username - Subscriber username
     */
    removeHiddenService(username) {
        const serviceDir = this._serviceDir(username);
        const services = this.parseTorrc();

        if (!services.some(s => s.dir === serviceDir)) {
            throw new Error(`Hidden service for '${username}' not found`);
        }

        // Rewrite torrc without this service's lines
        const content = fs.readFileSync(this.torrcPath, 'utf8');
        const lines = content.split('\n');
        const filtered = [];
        let skipping = false;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('HiddenServiceDir ')) {
                if (trimmed.includes(`ghost-sub-${username}`)) {
                    skipping = true;
                    continue;
                }
                skipping = false;
            }

            if (skipping && trimmed.startsWith('HiddenServicePort ')) {
                continue;
            }

            // Stop skipping on empty lines or non-port lines after a skip
            if (skipping && !trimmed.startsWith('HiddenServicePort ')) {
                skipping = false;
            }

            filtered.push(line);
        }

        fs.writeFileSync(this.torrcPath, filtered.join('\n'));

        // Remove directory
        if (fs.existsSync(serviceDir)) {
            fs.rmSync(serviceDir, {recursive: true, force: true});
        }
    }

    /**
     * Write Tor key files to a hidden service directory.
     *
     * @param {string} username
     * @param {Object} keys
     * @param {Buffer} keys.publicKey - 64-byte Tor-formatted public key
     * @param {Buffer} keys.secretKey - 96-byte Tor-formatted secret key
     * @param {string} keys.hostname - Full .onion hostname
     */
    writeKeys(username, {publicKey, secretKey, hostname}) {
        const serviceDir = this._serviceDir(username);

        fs.writeFileSync(path.join(serviceDir, 'hs_ed25519_public_key'), publicKey, {mode: 0o600});
        fs.writeFileSync(path.join(serviceDir, 'hs_ed25519_secret_key'), secretKey, {mode: 0o600});
        fs.writeFileSync(path.join(serviceDir, 'hostname'), hostname + '\n', {mode: 0o600});
    }

    /**
     * Get the status of a hidden service.
     *
     * @param {string} username
     * @returns {{exists: boolean, configured: boolean, hostname: string|null}}
     */
    getServiceStatus(username) {
        const serviceDir = this._serviceDir(username);
        const exists = fs.existsSync(serviceDir);
        const services = this.parseTorrc();
        const configured = services.some(s => s.dir === serviceDir);

        let hostname = null;
        const hostnamePath = path.join(serviceDir, 'hostname');
        if (exists && fs.existsSync(hostnamePath)) {
            hostname = fs.readFileSync(hostnamePath, 'utf8').trim();
        }

        return {exists, configured, hostname};
    }
}

module.exports = TorrcManager;
