// Invite links look like https://host/#room=BK5MA4SB. The key lives in the URL fragment, which browsers
// never send to a server, so it stays out of access logs and referrer headers.

const PARAM = /(?:^|[#&])room=([A-Za-z0-9-]{4,20})/;

/** The key in a location hash like "#room=BK5MA4SB", or '' if there isn't one. */
export function keyFromHash(hash) {
  return PARAM.exec(hash ?? '')?.[1].toUpperCase() ?? '';
}

/** A link that opens the lobby and joins the room. */
export function inviteLink(key, location = window.location) {
  return `${location.origin}${location.pathname}#room=${key}`;
}

/** Removes the key from the address bar once it has been used, so it isn't shared by accident. */
export function forgetInviteKey() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
