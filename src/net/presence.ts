/**
 * Real "N ONLINE" counter for the main menu: everyone sitting on the menu
 * joins one public presence room and we simply count peers (+ ourselves).
 * No messages are exchanged — pure peer discovery through the relay.
 */
import type {Room} from 'trystero'
import {netJoinRoom} from './room'

const PRESENCE_ROOM = 'PIXELPONG-PRESENCE-V1'

/** Start reporting the online count; returns a stop function. */
export function startPresence(onCount: (n: number) => void): () => void {
  let room: Room | null = null
  try {
    room = netJoinRoom({}, PRESENCE_ROOM)
  } catch {
    onCount(1)
    return () => {}
  }
  const update = () => onCount(Object.keys(room!.getPeers()).length + 1)
  room.onPeerJoin = update
  room.onPeerLeave = update
  // slow poll as a safety net for missed join/leave callbacks
  const iv = window.setInterval(update, 3000)
  update()
  return () => {
    window.clearInterval(iv)
    void room?.leave()
  }
}
