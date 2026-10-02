export type TrackStatus = 'pending' | 'queued' | 'playing' | 'done' | 'rejected';

export interface Track {
  id: string;
  deviceId: string;
  title: string;
  artist: string;
  requester: string;
  message: string;
  yt: string;
  audio: string;
  votes: Record<string, unknown>;
  status: TrackStatus;
  createdAt: number;
  playedAt: number;
}

export interface EventInfo {
  name: string;
  tagline: string;
  open: boolean;
  autoApprove: boolean;
  allowVotes: boolean;
  allowMessages: boolean;
}

export interface PlayerInfo {
  /** id tab/device yang memegang kendali pemutar (klaim /api/player/claim) */
  panel?: string;
  /** status yang dilaporkan heartbeat: memutar | siap | jeda | error */
  status?: string;
  detail?: string;
  trackId?: string;
  /** detik epoch (ms) heartbeat terakhir — segar <12s */
  updatedAt?: number;
  mode?: string;
  yt?: string;
  audio?: string;
  title?: string;
  artist?: string;
  startedAt?: number;
  duration?: number;
  [key: string]: unknown;
}

export interface AppState {
  event: EventInfo;
  tracks: Track[];
  order: string[];
  nextId: string | null;
  autoNext: boolean;
  player: PlayerInfo | null;
  beat: BeatInfo | null;
  serverTime: number;
}

/** Beat-grid dari panel DJ (POST /api/dj/beat) — bahan sinkron visualizer tamu. */
export interface BeatInfo {
  pos: number;
  dur: number;
  bpm: number | null;
  energy: number;
  playing: boolean;
  trackId: string | null;
  t: number;
  /** stempel waktu penerimaan di klien (diisi useLiveState) — deteksi basi */
  receivedAt?: number;
}

export interface Song {
  title: string;
  artist: string;
  yt: string;
  duration: string;
  source?: string;
}

export interface User {
  username: string;
  nama: string;
  peran: string;
}

export interface AdzanResponse {
  jadwal: Record<string, string> | null;
  durasi: number;
  enabled: boolean;
}
