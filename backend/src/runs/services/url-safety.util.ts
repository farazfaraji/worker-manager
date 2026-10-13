import * as dns from 'dns';
import * as net from 'net';

/**
 * SSRF protection for URLs chosen by an LLM (or other untrusted input).
 * Blocks loopback, private, link-local (incl. cloud metadata 169.254.169.254),
 * CGNAT, multicast and other reserved ranges, and re-checks every redirect hop.
 *
 * Set ALLOW_PRIVATE_NETWORK_FETCH=true to disable (local development only).
 */

const blockList = new net.BlockList();
// IPv4
blockList.addSubnet('0.0.0.0', 8, 'ipv4');
blockList.addSubnet('10.0.0.0', 8, 'ipv4');
blockList.addSubnet('100.64.0.0', 10, 'ipv4');
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
blockList.addSubnet('169.254.0.0', 16, 'ipv4');
blockList.addSubnet('172.16.0.0', 12, 'ipv4');
blockList.addSubnet('192.0.0.0', 24, 'ipv4');
blockList.addSubnet('192.0.2.0', 24, 'ipv4');
blockList.addSubnet('192.168.0.0', 16, 'ipv4');
blockList.addSubnet('198.18.0.0', 15, 'ipv4');
blockList.addSubnet('198.51.100.0', 24, 'ipv4');
blockList.addSubnet('203.0.113.0', 24, 'ipv4');
blockList.addSubnet('224.0.0.0', 4, 'ipv4');
blockList.addSubnet('240.0.0.0', 4, 'ipv4');
// IPv6
blockList.addAddress('::', 'ipv6');
blockList.addAddress('::1', 'ipv6');
blockList.addSubnet('fc00::', 7, 'ipv6');
blockList.addSubnet('fe80::', 10, 'ipv6');
blockList.addSubnet('ff00::', 8, 'ipv6');
blockList.addSubnet('2001:db8::', 32, 'ipv6');

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: HostLookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

export function isPrivateNetworkFetchAllowed(): boolean {
  return String(process.env.ALLOW_PRIVATE_NETWORK_FETCH || '').toLowerCase() === 'true';
}

export function isBlockedAddress(address: string): boolean {
  let ip = address.replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) -> check the embedded IPv4 address
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blockList.check(mapped[1], 'ipv4');
    return blockList.check(ip, 'ipv6');
  }
  return blockList.check(ip, 'ipv4');
}

/**
 * Throws BlockedUrlError if the URL is not http(s) or resolves to a non-public address.
 */
export async function assertPublicHttpUrl(rawUrl: string, lookup: HostLookup = defaultLookup): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`Invalid URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedUrlError(`Only HTTP and HTTPS URLs are allowed (got "${parsed.protocol}").`);
  }
  if (isPrivateNetworkFetchAllowed()) return parsed;

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) {
    throw new BlockedUrlError(`Access to internal host "${hostname}" is blocked.`);
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedUrlError(`Access to private/internal address "${hostname}" is blocked.`);
    }
    return parsed;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch (err: any) {
    throw new BlockedUrlError(`Could not resolve host "${hostname}": ${err?.code || err?.message || err}`);
  }
  const blocked = addresses.find((a) => isBlockedAddress(a.address));
  if (blocked) {
    throw new BlockedUrlError(`Host "${hostname}" resolves to private/internal address ${blocked.address}; access is blocked.`);
  }
  return parsed;
}

/**
 * fetch() that validates the initial URL and every redirect hop against the SSRF guard.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number; lookup?: HostLookup } = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(currentUrl, options.lookup);
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    const status = response.status;
    const location = response.headers?.get?.('location');
    if (status >= 300 && status < 400 && location) {
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.url) {
      // Preserve the final URL for callers that read response.url (mocks may omit it)
      try {
        Object.defineProperty(response, 'url', { value: currentUrl });
      } catch {
        // ignore read-only response objects
      }
    }
    return response;
  }
  throw new BlockedUrlError(`Too many redirects (>${maxRedirects}) for "${rawUrl}".`);
}
