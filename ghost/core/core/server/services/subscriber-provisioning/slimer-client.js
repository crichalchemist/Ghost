const http = require('http');
const https = require('https');
const logging = require('@tryghost/logging');

class SlimerClient {
    /**
     * @param {Object} [options]
     * @param {string} [options.baseUrl] - Slimer API base URL
     * @param {string} [options.authSecret] - Shared secret for authentication
     */
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || process.env.SLIMER_API_URL || 'http://10.0.0.5:3100';
        this.authSecret = options.authSecret || process.env.SLIMER_AUTH_SECRET || '';
    }

    /**
     * Make an HTTP request to the slimer API
     * @param {string} method
     * @param {string} urlPath
     * @param {Object} [body]
     * @returns {Promise<{status: number, body: Object}>}
     */
    _request(method, urlPath, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, this.baseUrl);
            const transport = url.protocol === 'https:' ? https : http;

            const opts = {
                method,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                headers: {
                    'Authorization': `Bearer ${this.authSecret}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            };

            const req = transport.request(opts, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve({status: res.statusCode, body: JSON.parse(data)});
                    } catch {
                        resolve({status: res.statusCode, body: data});
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy(new Error('Request to slimer API timed out'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Create a hidden service on slimer
     * @param {Object} params
     * @param {string} params.username
     * @param {string} params.target - e.g. "10.0.0.4:2368" or ACA FQDN
     * @param {Buffer} params.publicKey - 64-byte Tor-formatted public key
     * @param {Buffer} params.secretKey - 96-byte Tor-formatted secret key
     * @param {string} params.hostname - Full .onion hostname
     * @returns {Promise<{username: string, hostname: string}>}
     */
    async createHiddenService({username, target, publicKey, secretKey, hostname}) {
        logging.info(`Creating hidden service for ${username} on slimer`);

        const res = await this._request('POST', '/hidden-services', {
            username,
            target,
            publicKey: publicKey.toString('base64'),
            secretKey: secretKey.toString('base64'),
            hostname
        });

        if (res.status !== 201) {
            throw new Error(`Slimer API error (${res.status}): ${JSON.stringify(res.body)}`);
        }

        return res.body;
    }

    /**
     * Remove a hidden service from slimer
     * @param {string} username
     */
    async removeHiddenService(username) {
        logging.info(`Removing hidden service for ${username} from slimer`);

        const res = await this._request('DELETE', `/hidden-services/${username}`);

        if (res.status !== 200) {
            throw new Error(`Slimer API error (${res.status}): ${JSON.stringify(res.body)}`);
        }

        return res.body;
    }

    /**
     * Get hidden service status
     * @param {string} username
     * @returns {Promise<{exists: boolean, configured: boolean, hostname: string|null}>}
     */
    async getStatus(username) {
        const res = await this._request('GET', `/hidden-services/${username}/status`);

        if (res.status !== 200) {
            throw new Error(`Slimer API error (${res.status}): ${JSON.stringify(res.body)}`);
        }

        return res.body;
    }
}

module.exports = SlimerClient;
