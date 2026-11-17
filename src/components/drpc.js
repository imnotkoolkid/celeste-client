const DiscordRPC = require('discord-rpc');
const { URL } = require('url');

const STATIC_STATES = {
    '/': 'In main lobby',
    '/hub/leaderboard': 'Viewing player leaderboard',
    '/hub/clans/champions-league': 'Viewing clan leaderboard',
    '/hub/ranked/leaderboard-point3v3': 'Viewing ranked leaderboard: Point 3v3',
    '/hub/ranked/leaderboard-point2v2': 'Viewing ranked leaderboard: Point 2v2',
    '/hub/ranked/leaderboard-sad': 'Viewing ranked leaderboard: Search And Destroy',
    '/hub/ranked/leaderboard-1v1': 'Viewing ranked leaderboard: 1v1',
    '/hub/clans/my-clan': 'Viewing their clan',
    '/hub/market': 'Viewing market',
    '/hub/live': 'Viewing videos',
    '/hub/news': 'Viewing news',
    '/hub/terms': 'Viewing terms of service',
    '/store': 'Viewing store',
    '/servers/main': 'Viewing servers',
    '/servers/parkour': 'Viewing parkour servers',
    '/servers/custom': 'Viewing custom servers',
    '/quests/hourly': 'Viewing hourly quests',
    '/friends': 'Viewing their friends',
    '/inventory': 'Viewing their inventory'
};
const CLIENT_ID = '1506214153369423922';
const DOWNLOAD_BUTTON = { label: 'Download', url: 'https://github.com/imnotkoolkid/celeste-client/releases' };

class DRPC {
    constructor() {
        this.client = null;
        this.connected = false;
        this.time = new Date();
        this.state = '';
        this.currentFullUrl = null;
        this._lastActivityState = null;
        this.settings = null;
    }
    init(settings) {
        this.settings = settings;
        if (!settings || !settings['show rpc']) {
            this.destroy();
            return;
        }
        if (this.connected && this.client) {
            this.setActivity();
            return;
        }
        this.destroy();
        try {
            DiscordRPC.register(CLIENT_ID);
            this.client = new DiscordRPC.Client({ transport: 'ipc' });
            this.client.on('ready', () => {
                this.connected = true;
                this.setActivity();
            });
            this.client.login({ clientId: CLIENT_ID }).catch(err => {
                console.log('Discord RPC failed to connect:', err.message);
                this.connected = false;
            });
        } catch (e) {
            console.error('Failed to init Discord RPC:', e);
            this.connected = false;
        }
    }
    destroy() {
        this.connected = false;
        this._lastActivityState = null;
        if (this.client) {
            try { this.client.destroy().catch(() => {}); } catch (_) {}
            this.client = null;
        }
    }
    setActivity() {
        if (!this.connected || this._lastActivityState === this.state) return;
        this._lastActivityState = this.state;
        const buttons = [DOWNLOAD_BUTTON];
        if (this.currentFullUrl) {
            try {
                const { pathname } = new URL(this.currentFullUrl);
                if (pathname.startsWith('/games')) {
                    buttons.push({ label: 'Join Game', url: this.currentFullUrl });
                }
            } catch { }
        }
        const activity = {
            startTimestamp: this.time,
            largeImageKey: 'celeste',
            largeImageText: 'Celeste Client',
            instance: true,
            buttons
        };
        if (this.state && this.state.trim() !== '') {
            activity.state = this.state;
        }
        this.client.setActivity(activity).catch(console.error);
    }
    setState(url) {
        if (!this.connected || !url || this.currentFullUrl === url) return;
        this.currentFullUrl = url;
        try {
            const { pathname } = new URL(url);
            let result = 'Playing kirka.io';
            if (pathname.startsWith('/games')) {
                if (this.settings?.['rpc match info']) {
                    const [server, roomId] = pathname.split('/').pop().split('~');
                    result = `Playing a match on ${server || 'unknown'} server${roomId ? ` - ${roomId}` : ''}`;
                } else {
                    result = 'In a match';
                }
            } else if (pathname.startsWith('/profile')) {
                result = `Viewing player profile with ID ${pathname.split('/').pop()}`;
            } else {
                result = STATIC_STATES[pathname] || result;
            }
            this.state = result;
            this.setActivity();
        } catch (err) {
            console.error('Invalid URL in DRPC setState:', err);
        }
    }
}
module.exports = new DRPC();
