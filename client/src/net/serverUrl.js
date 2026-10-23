// Where the game server is. Set VITE_SERVER_URL for a deployed server (see client/.env.example). Otherwise it is
// the machine serving the page, on port 3001, so the game works whether you open it as localhost or at the
// network address (192.168.x.x) another device would use.
const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `${window.location.protocol}//${host}:3001`;
