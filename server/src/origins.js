// Which web pages may talk to this server. CLIENT_ORIGIN lists them for a deployment (comma-separated). Left unset,
// the server is in development mode and accepts the pages you'd open on your own machine or home network:
// localhost, 127.0.0.1, and private addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x), on any port. Opening the game
// at the "Network" address Vite prints (so a second device can join) therefore works without any setting.

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

export function parseOrigins(value) {
  return value ? value.split(',').map((o) => o.trim()).filter(Boolean) : null;
}

/** Returns a function origin => boolean. `list` is the parsed CLIENT_ORIGIN, or null for the development default. */
export function createOriginCheck(list) {
  if (list) {
    const allowed = new Set(list);
    return (origin) => allowed.has(origin);
  }
  return (origin) => {
    try {
      const { protocol, hostname } = new URL(origin);
      return (protocol === 'http:' || protocol === 'https:') && PRIVATE_HOST.test(hostname);
    } catch {
      return false;
    }
  };
}
