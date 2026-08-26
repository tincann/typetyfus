export type PeerId = string
export type Phase = 'lobby' | 'countdown' | 'running' | 'finished'
export type PeerInfo = { id: PeerId; nick: string; connected: boolean }
