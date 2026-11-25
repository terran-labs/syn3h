/**
 * "Show my location to other players" (the Me card, Privacy): on by default. Off, the room
 * keeps your place to itself and the Players card shows only your device. The net client sends
 * it in hello and as a profile change ({ type: 'profile', shareLocation }), as it does for
 * "Bots may play with me". The server never sends anything finer than a region and a country.
 */
import { defineParam } from '../../../shared/params'

export const shareLocation = defineParam({ id: 'net.shareLocation', label: 'Show my location to other players', group: 'Privacy', scope: 'client', default: true })
