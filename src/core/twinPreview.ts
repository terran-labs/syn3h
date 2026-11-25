// Capture the opt-in before LobbyAddress cleans the visible lobby URL.
const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('twins') === '1'

export function lobbyTwinsEnabled(): boolean { return enabled }
