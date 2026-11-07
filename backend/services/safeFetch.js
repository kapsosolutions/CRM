// Fetching a URL a business typed in (a flow banner, a picture in a PDF
// template) without letting it reach this server's own network: localhost,
// the cloud metadata service (169.254.169.254), Redis, private ranges.
//
// Every connection (including each redirect) resolves the host through a
// lookup that refuses non-public addresses, so a DNS name can't point at one
// either. Only http(s).
import axios from 'axios';
import dns from 'dns';
import net from 'net';

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4ToInt = (ip) => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);

/** Is this IP address somewhere a user-supplied URL must not reach? */
export function isBlockedAddress(ip) {
  const addr = String(ip || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(addr)) {
    const n = v4ToInt(addr);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
    });
  }
  if (net.isIPv6(addr)) {
    if (addr === '::' || addr === '::1') return true;
    // IPv4-mapped / -compatible (::ffff:10.0.0.1)
    const mapped = addr.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(addr)) return true; // mapped, hex form
    const first = parseInt(addr.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (addr.startsWith('64:ff9b:') || addr.startsWith('2001:db8:')) return true;
    return false;
  }
  return true; // not an IP at all: refuse
}

class BlockedUrlError extends Error {
  constructor(message) {
    super(message);
    this.code = 'BLOCKED_URL';
  }
}

/** Throws unless `url` is http(s) and, when its host is an IP, a public one. */
export function assertFetchableUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new BlockedUrlError('not a valid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new BlockedUrlError('only http(s) URLs can be fetched');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedUrlError('that address is not reachable');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new BlockedUrlError('that address is not reachable');
  return u;
}

/** dns.lookup that refuses non-public answers (used for every connection). */
export function publicLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' && options ? options : {};
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || 4 }];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      return cb(new BlockedUrlError(`${hostname} resolves to a non-public address`));
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

/**
 * GET a user-supplied URL as a Buffer, refusing internal addresses.
 * @returns {Promise<Buffer>}
 */
export async function safeGetBuffer(url, { timeout = 15000, maxBytes = 10 * 1024 * 1024 } = {}) {
  assertFetchableUrl(url);
  const res = await axios.get(String(url), {
    responseType: 'arraybuffer',
    timeout,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    maxRedirects: 3,
    lookup: publicLookup,
    // Redirects are checked too (an IP-literal target never reaches lookup).
    beforeRedirect: (options) => {
      const target = `${options.protocol}//${options.hostname || options.host}`;
      assertFetchableUrl(target);
    },
  });
  return Buffer.from(res.data);
}

export default { safeGetBuffer, assertFetchableUrl, isBlockedAddress, publicLookup };
