/**
 * GeolocationService — IP-based location lookup.
 *
 * Uses ip-api.com free endpoint (45 req/min, no API key).
 * Caches results per-IP for the process lifetime so a chatty page that
 * reconnects sockets doesn't hammer the upstream API.
 *
 * Returns null for localhost / private / unresolvable IPs.
 * Never throws — the caller treats null as "unknown" and moves on.
 */

const http = require("http");

const cache = new Map();
const FETCH_TIMEOUT_MS = 2500;

// RFC1918 + loopback + IPv6 link-local — anything we shouldn't bother looking up.
function isLocalOrPrivateIp(ip) {
    if (!ip || ip === "::1" || ip === "127.0.0.1") return true;
    // ::ffff:192.168.x.x — IPv4-mapped IPv6
    const cleaned = ip.replace(/^::ffff:/, "");
    if (/^127\./.test(cleaned)) return true;
    if (/^10\./.test(cleaned)) return true;
    if (/^192\.168\./.test(cleaned)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(cleaned)) return true;
    if (/^fe80:/i.test(ip)) return true;
    if (/^fc[\da-f]{2}:/i.test(ip)) return true;
    return false;
}

function lookupViaIpApi(ip) {
    return new Promise((resolve) => {
        const req = http.get(
            `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,region,regionName,city,lat,lon,timezone,query`,
            (res) => {
                let buf = "";
                res.on("data", (c) => (buf += c));
                res.on("end", () => {
                    try {
                        const data = JSON.parse(buf);
                        if (data && data.status === "success") {
                            resolve({
                                city: data.city || null,
                                region: data.regionName || null,
                                country: data.country || null,
                                countryCode: data.countryCode || null,
                                lat: data.lat ?? null,
                                lon: data.lon ?? null,
                                timezone: data.timezone || null,
                                ip: data.query || ip,
                                source: "ip-api",
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });
            },
        );
        req.setTimeout(FETCH_TIMEOUT_MS, () => {
            req.destroy();
            resolve(null);
        });
        req.on("error", () => resolve(null));
    });
}

/**
 * Resolves location for a given IP. Returns null for local/private/unresolvable.
 * Caches successful lookups indefinitely (process-lifetime).
 */
async function resolveLocation(ip) {
    if (isLocalOrPrivateIp(ip)) return null;
    if (cache.has(ip)) return cache.get(ip);

    const result = await lookupViaIpApi(ip);
    if (result) cache.set(ip, result);
    return result;
}

/**
 * Extracts the client's public IP from a Socket.IO socket.
 * Header precedence (most-specific → least):
 *   1. CF-Connecting-IP   — Cloudflare
 *   2. CloudFront-Viewer-Address — AWS CloudFront (also strips :port)
 *   3. True-Client-IP     — Akamai / some CDNs
 *   4. X-Forwarded-For    — generic chain; first entry = original client
 *   5. socket.handshake.address — direct TCP peer (EC2 direct, no LB)
 */
function extractClientIp(socket) {
    if (!socket || !socket.handshake) return null;
    const h = socket.handshake.headers || {};

    if (h["cf-connecting-ip"]) return h["cf-connecting-ip"].trim();
    if (h["cloudfront-viewer-address"]) {
        // Format: "203.0.113.45:54321" — strip port
        return h["cloudfront-viewer-address"].split(":")[0].trim();
    }
    if (h["true-client-ip"]) return h["true-client-ip"].trim();
    if (h["x-real-ip"]) return h["x-real-ip"].trim();   // nginx default
    if (h["x-forwarded-for"]) {
        const first = h["x-forwarded-for"].split(",")[0].trim();
        if (first) return first;
    }
    if (h["forwarded"]) {
        const m = h["forwarded"].match(/for=(?:"\[?)?([^";,\s\]]+)/i);
        if (m && m[1]) return m[1].replace(/^\[|\]$/g, "");
    }
    const fallback = socket.handshake.address || null;
    if (fallback && (fallback === "::1" || fallback === "::ffff:127.0.0.1" || fallback === "127.0.0.1")) {
        const relevant = {};
        for (const k of Object.keys(h)) {
            if (/^(x-|cf-|true-|cloudfront-|forwarded|via|fastly-|akamai-)/i.test(k)) {
                relevant[k] = h[k];
            }
        }
        console.log(`[Geo] fallback to ${fallback}. Proxy headers seen:`, JSON.stringify(relevant) || "(none — proxy not forwarding any client-IP header)");
    }
    return fallback;
}

module.exports = { resolveLocation, extractClientIp, isLocalOrPrivateIp };
