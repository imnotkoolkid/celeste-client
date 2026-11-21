'use strict';

/* Proxy gate: Intermediary (127.0.0.1) between Chromium and the upstream proxy */

const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');

const DEFAULT_MAX_CONNECTIONS = 8;
const IDLE_BEFORE_RECYCLE_MS = 2000;
const QUEUE_TIMEOUT_MS = 20000;
const UPSTREAM_TIMEOUT_MS = 15000;
const SNIFF_LIMIT = 8192;

const gates = new Map();
const noop = () => {};

const keyOf = u => [u.protocol, u.host, u.port, u.username || '', u.password || ''].join('\u0000');
const bareHost = h => String(h).replace(/^\[|\]$/g, '');

const splitHostPort = (target, fallback) => {
    const i = target.lastIndexOf(':');
    return (i === -1 || target.endsWith(']'))
        ? [bareHost(target), fallback]
        : [bareHost(target.slice(0, i)), Number(target.slice(i + 1)) || fallback];
};

function basicAuth(upstream) {
    if (!upstream.username) return '';
    return upstream._auth ||= 'Basic ' + Buffer.from(`${upstream.username}:${upstream.password || ''}`).toString('base64');
}

function isLongLivedHello(buf) {
    if (buf.length < 5) return null;
    if (buf[0] !== 0x16) return true;
    const recordEnd = 5 + buf.readUInt16BE(3);
    if (buf.length < recordEnd && buf.length < SNIFF_LIMIT) return null;
    try {
        let p = 5;
        if (buf[p] !== 0x01) return true;
        p += 38;
        p += 1 + buf[p]; 
        p += 2 + buf.readUInt16BE(p); 
        p += 1 + buf[p]; 
        const extEnd = p + 2 + buf.readUInt16BE(p);
        p += 2;
        while (p + 4 <= extEnd && p + 4 <= buf.length) {
            const type = buf.readUInt16BE(p);
            const len = buf.readUInt16BE(p + 2);
            p += 4;
            if (type === 0x0010) { 
                const end = p + len;
                let q = p + 2;
                while (q < end && q < buf.length) {
                    const l = buf[q];
                    if (l === 2 && buf[q + 1] === 0x68 && buf[q + 2] === 0x32) return false; 
                    q += 1 + l;
                }
                return true;
            }
            p += len;
        }
    } catch (_) {}
    return true;
}

function openTunnel(upstream, host, port, cb) {
    const proxyHost = bareHost(upstream.host);
    const proxyPort = Number(upstream.port);
    const sock = upstream.protocol === 'https'
        ? tls.connect({ host: proxyHost, port: proxyPort, servername: net.isIP(proxyHost) ? undefined : proxyHost })
        : net.connect({ host: proxyHost, port: proxyPort });

    let buf = Buffer.alloc(0);
    let stage = 0;
    let settled = false;

    const finish = (err, rest) => {
        if (settled) return;
        settled = true;
        sock.setTimeout(0);
        sock.removeListener('data', onData);
        if (err) {
            sock.destroy();
            cb(err);
        } else {
            cb(null, sock, rest);
        }
    };
    const fail = (msg, authFailed = false) => finish(Object.assign(new Error(msg), { authFailed }));

    sock.setNoDelay(true);
    sock.setTimeout(UPSTREAM_TIMEOUT_MS, () => fail('proxy did not answer'));
    sock.on('error', err => fail(err.message));
    sock.on('close', () => fail('proxy closed the connection'));

    const isSocks = upstream.protocol === 'socks5';
    sock.once(upstream.protocol === 'https' ? 'secureConnect' : 'connect', () => {
        if (isSocks) {
            sock.write(Buffer.from(upstream.username ? [5, 2, 0, 2] : [5, 1, 0]));
            return;
        }
        const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
        const auth = basicAuth(upstream);
        sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`);
    });

    function onData(chunk) {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;

        if (!isSocks) {
            const end = buf.indexOf('\r\n\r\n');
            if (end === -1) {
                if (buf.length > 16384) fail('bad answer from proxy');
                return;
            }
            const status = Number((buf.toString('latin1', 0, end).match(/^HTTP\/\d\.\d (\d{3})/) || [])[1]);
            return status === 200 ? finish(null, buf.subarray(end + 4)) : fail(`proxy answered ${status || 'garbage'}`, status === 407);
        }

        if (stage === 0) {
            if (buf.length < 2) return;
            if (buf[0] !== 5) return fail('not a SOCKS5 proxy');
            const method = buf[1];
            buf = buf.subarray(2);
            if (method === 2) {
                const u = Buffer.from(upstream.username || '', 'utf8');
                const p = Buffer.from(upstream.password || '', 'utf8');
                if (u.length > 255 || p.length > 255) return fail('username or password too long', true);
                sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
                stage = 1;
            } else if (method === 0) {
                stage = 2;
            } else {
                return fail('proxy refused the login method', true);
            }
        }

        if (stage === 1) {
            if (buf.length < 2) return;
            if (buf[1] !== 0) return fail('proxy rejected the username/password', true);
            buf = buf.subarray(2);
            stage = 2;
        }

        if (stage === 2) {
            const name = Buffer.from(host, 'utf8');
            if (name.length > 255) return fail('hostname too long');
            const head = net.isIPv4(host)
                ? Buffer.from([5, 1, 0, 1, ...host.split('.').map(Number)])
                : Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name]);
            const portBytes = Buffer.allocUnsafe(2);
            portBytes.writeUInt16BE(port);
            sock.write(Buffer.concat([head, portBytes]));
            stage = 3;
        }

        if (stage === 3) {
            if (buf.length < 5) return;
            if (buf[1] !== 0) return fail(`proxy could not reach the server (SOCKS code ${buf[1]})`);
            const len = buf[3] === 1 ? 10 : buf[3] === 4 ? 22 : 7 + buf[4];
            if (buf.length < len) return;
            return finish(null, buf.subarray(len));
        }
    }
    sock.on('data', onData);
}

class Gate {
    constructor(upstream, maxConnections) {
        this.upstream = upstream;
        this.max = maxConnections;
        this.refs = 1;
        this.conns = new Set();
        this.queue = [];
        this.timer = null;
        this.stats = { opened: 0, recycled: 0, waited: 0, timedOut: 0, failed: 0, peak: 0 };

        this.server = http.createServer((req, res) => this.onRequest(req, res))
            .on('connect', (req, client, head) => this.onConnect(req, client, head))
            .on('clientError', (_, socket) => socket.destroy());
    }

    reserve(conn, ready) {
        this.queue.push({ conn, ready, since: Date.now() });
        this.pump();
    }

    pump() {
        const now = Date.now();
        while (this.queue.length) {
            const next = this.queue[0];
            if (now - next.since > QUEUE_TIMEOUT_MS) {
                this.queue.shift();
                this.stats.timedOut++;
                next.ready(false);
                continue;
            }
            if (this.conns.size >= this.max && !this.recycleOne(now)) break;
            this.queue.shift();
            if (now - next.since > 50) this.stats.waited++;
            this.conns.add(next.conn);
            this.stats.opened++;
            this.stats.peak = Math.max(this.stats.peak, this.conns.size);
            next.ready(true);
        }

        if (this.queue.length && !this.timer) {
            this.timer = setInterval(() => this.pump(), 200);
            this.timer.unref();
        } else if (!this.queue.length && this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    recycleOne(now) {
        let pick = null;
        for (const conn of this.conns) {
            if (conn.keep || !conn.remote) continue;
            if (now - conn.last >= IDLE_BEFORE_RECYCLE_MS && (!pick || conn.last < pick.last)) pick = conn;
        }
        if (!pick) return false;
        this.stats.recycled++;
        this.drop(pick);
        return true;
    }

    drop(conn) {
        if (!this.conns.delete(conn)) return;
        if (conn.client) conn.client.destroy();
        if (conn.remote) conn.remote.destroy();
        setImmediate(() => this.pump());
    }

    onConnect(req, client, head) {
        const [host, port] = splitHostPort(req.url, 443);
        const conn = { client, remote: null, keep: false, last: Date.now(), sniff: Buffer.alloc(0), sniffed: false };
        let clientGone = false;

        client.on('error', noop);
        client.on('close', () => {
            clientGone = true;
            this.drop(conn);
        });

        this.reserve(conn, ok => {
            if (clientGone) return this.drop(conn);
            if (!ok) return client.end('HTTP/1.1 504 Gateway Timeout\r\n\r\n');

            openTunnel(this.upstream, host, port, (err, remote, rest) => {
                if (err || clientGone) {
                    if (remote) remote.destroy();
                    if (err) this.stats.failed++;
                    this.conns.delete(conn);
                    if (!clientGone) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                    setImmediate(() => this.pump());
                    return;
                }

                conn.remote = remote;
                conn.last = Date.now();

                const onRemoteData = () => { conn.last = Date.now(); };
                const onClientData = chunk => {
                    conn.last = Date.now();
                    if (conn.sniffed) return;
                    conn.sniff = conn.sniff.length ? Buffer.concat([conn.sniff, chunk]) : chunk;
                    const longLived = isLongLivedHello(conn.sniff);
                    if (longLived === null) return;
                    conn.sniffed = true;
                    conn.keep = longLived;
                    conn.sniff = null;
                    if (longLived) {
                        remote.removeListener('data', onRemoteData);
                        client.removeListener('data', onClientData);
                    }
                };

                remote.on('error', noop);
                remote.on('close', () => this.drop(conn));
                remote.on('data', onRemoteData);
                client.on('data', onClientData);

                client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (rest && rest.length) client.write(rest);
                if (head && head.length) {
                    onClientData(head);
                    remote.write(head);
                }
                client.pipe(remote);
                remote.pipe(client);
            });
        });
    }

    onRequest(req, res) {
        const conn = { client: req.socket, remote: null, keep: true, last: Date.now() };
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            if (this.conns.delete(conn)) setImmediate(() => this.pump());
        };
        const bad = (code = 502) => {
            if (!res.headersSent) res.writeHead(code);
            res.end();
            finish();
        };
        res.on('close', finish);

        let url;
        try { url = new URL(req.url); } catch (_) { return bad(400); }

        const headers = { ...req.headers };
        delete headers['proxy-connection'];
        delete headers['proxy-authorization'];

        this.reserve(conn, ok => {
            if (done) return finish();
            if (!ok) return bad(504);

            const relay = out => {
                out.on('response', upstreamRes => {
                    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
                    upstreamRes.pipe(res);
                }).on('error', () => bad());
                req.pipe(out);
            };

            if (this.upstream.protocol === 'socks5') {
                const port = Number(url.port) || 80;
                openTunnel(this.upstream, bareHost(url.hostname), port, (err, sock) => {
                    if (err) return bad();
                    relay(http.request({ createConnection: () => sock, host: url.hostname, port, method: req.method, path: url.pathname + url.search, headers }));
                });
                return;
            }

            const auth = basicAuth(this.upstream);
            if (auth) headers['proxy-authorization'] = auth;
            const lib = this.upstream.protocol === 'https' ? https : http;
            relay(lib.request({ host: bareHost(this.upstream.host), port: Number(this.upstream.port), method: req.method, path: req.url, headers, agent: false }));
        });
    }

    close() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        for (const item of this.queue.splice(0)) item.ready(false);
        for (const conn of [...this.conns]) this.drop(conn);
        try { this.server.close(); } catch (_) {}
    }
}

function acquire(upstream, maxConnections) {
    const key = keyOf(upstream);
    const existing = gates.get(key);
    if (existing) {
        existing.gate.refs++;
        return existing.ready;
    }

    const max = Math.max(2, Math.min(64, Number(maxConnections) || DEFAULT_MAX_CONNECTIONS));
    const target = { protocol: upstream.protocol, host: upstream.host, port: upstream.port, username: upstream.username, password: upstream.password };
    const gate = new Gate(target, max);
    const ready = new Promise((resolve, reject) => {
        gate.server.once('error', err => {
            gates.delete(key);
            reject(err);
        }).listen(0, '127.0.0.1', () => resolve({ key, port: gate.server.address().port }));
    });
    gates.set(key, { gate, ready });
    return ready;
}

function release(key) {
    const entry = gates.get(key);
    if (!entry || --entry.gate.refs > 0) return;
    gates.delete(key);
    entry.gate.close();
}

function closeAll() {
    for (const entry of gates.values()) entry.gate.close();
    gates.clear();
}

function snapshot() {
    return [...gates.values()].map(({ gate }) => ({
        proxy: `${gate.upstream.host}:${gate.upstream.port}`,
        limit: gate.max,
        open: gate.conns.size,
        kept: [...gate.conns].filter(c => c.keep).length,
        waiting: gate.queue.length,
        ...gate.stats
    }));
}

module.exports = { acquire, release, closeAll, snapshot, SUPPORTED: new Set(['http', 'https', 'socks5']) };
