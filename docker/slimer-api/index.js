const createApp = require('./lib/app');

const PORT = process.env.PORT || 3100;
const TORRC_PATH = process.env.TORRC_PATH || '/etc/tor/torrc';
const HIDDEN_SERVICES_DIR = process.env.HIDDEN_SERVICES_DIR || '/var/lib/tor/hidden-services';
const AUTH_SECRET = process.env.AUTH_SECRET;
const TOR_USER = process.env.TOR_USER || 'debian-tor';
const SIGNAL_TOR = process.env.SIGNAL_TOR !== 'false';

if (!AUTH_SECRET) {
    console.error('AUTH_SECRET environment variable is required');
    process.exit(1);
}

const app = createApp({
    torrcPath: TORRC_PATH,
    hiddenServicesDir: HIDDEN_SERVICES_DIR,
    authSecret: AUTH_SECRET,
    signalTor: SIGNAL_TOR,
    torUser: TOR_USER
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Slimer API listening on port ${PORT}`);
});
