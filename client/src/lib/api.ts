import type { AdzanResponse, AppState, PlayerInfo, Song, Track, User } from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super('Sesi kamu habis. Masuk ulang untuk request lagi.', 401);
    this.name = 'SessionExpiredError';
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function apiGet<T>(path: string, token = ''): Promise<T> {
  const res = await fetch(path, {
    headers: token ? { 'x-dj-token': token } : {},
  });
  const data = await readJson(res);
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) throw new ApiError(String(data.error || `Gagal (${res.status})`), res.status);
  return data as T;
}

/**
 * Kirim data dengan method apa pun. 503 = server sedang sibuk (mis. heartbeat
 * panel DJ sedang menyimpan) → dicoba beberapa kali supaya request tidak
 * hilang. 401 = sesi hangus → SessionExpiredError supaya pemanggil kembali ke
 * gerbang login.
 */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown = {},
  token = '',
): Promise<T> {
  let res: Response | null = null;
  let data: Record<string, unknown> = {};
  for (let percobaan = 1; percobaan <= 4; percobaan++) {
    res = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-dj-token': token } : {}),
      },
      body: JSON.stringify(body),
    });
    data = await readJson(res);
    if (res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 400 * percobaan));
  }
  if (!res) throw new ApiError('Tidak ada jawaban server.', 0);
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) throw new ApiError(String(data.error || `Gagal (${res.status})`), res.status);
  return data as T;
}

export const apiPost = <T>(path: string, body: unknown, token = '') =>
  apiSend<T>('POST', path, body, token);

export const fetchState = () => apiGet<AppState>('/api/state');

export const fetchMe = (token: string) => apiGet<User>('/api/me', token);

export const login = (username: string, password: string) =>
  apiPost<{ token: string; username: string; nama: string; peran: string }>(
    '/api/login',
    { username, password },
  );

export const searchSongs = (q: string, limit = 8) =>
  apiGet<{ songs: Song[]; detected: Song | null }>(
    `/api/songs?q=${encodeURIComponent(q)}&limit=${limit}`,
  );

export const changePassword = (token: string, passwordLama: string, passwordBaru: string) =>
  apiPost<{ token: string }>(
    '/api/dj/password',
    { passwordLama, passwordBaru },
    token,
  );

export interface RequestPayload {
  title: string;
  artist: string;
  message: string;
  yt: string;
}

export const submitRequest = (token: string, payload: RequestPayload) =>
  apiPost<{ status: string; track: { id: string } }>('/api/request', payload, token);

export const voteTrack = (token: string, trackId: string) =>
  apiPost<{ voted: boolean; voteCount: number }>('/api/vote', { trackId }, token);

export const fetchAdzan = (tanggal: string) =>
  apiGet<AdzanResponse>(`/api/adzan?tanggal=${encodeURIComponent(tanggal)}`);

/* ------------------------------------------------- endpoint panel DJ */

export const djTrackAction = (
  token: string,
  id: string,
  action: string,
  extra: Record<string, unknown> = {},
) =>
  apiSend<{ track: Track }>(
    'POST',
    `/api/dj/track/${encodeURIComponent(id)}`,
    { action, ...extra },
    token,
  );

export const djAdvance = (token: string) =>
  apiSend<{ playing: Track | null }>('POST', '/api/dj/advance', {}, token);

export const djSetAuto = (token: string, enabled: boolean) =>
  apiSend('POST', '/api/dj/auto', { enabled }, token);

/** payload beat-grid dari panel DJ (server menambahkan `t` sendiri) */
export const djBeat = (
  token: string,
  payload: {
    pos: number;
    dur: number;
    bpm: number | null;
    energy: number;
    beatIdx?: number | null;
    playing: boolean;
    trackId: string | null;
  },
) => apiSend('POST', '/api/dj/beat', payload, token);

export const djClearDone = (token: string) => apiSend('POST', '/api/dj/clear-done', {}, token);

export const djClearAll = (token: string) => apiSend('POST', '/api/dj/clear-all', {}, token);

export const patchEvent = (token: string, body: Partial<Record<string, unknown>>) =>
  apiSend('PATCH', '/api/event', body, token);

export const playerClaim = (token: string, panel: string, paksa: boolean) =>
  apiSend<{ player: PlayerInfo | null }>('POST', '/api/player/claim', { panel, paksa }, token);

export const playerRelease = (token: string, panel: string) =>
  apiSend('POST', '/api/player/release', { panel }, token);

export const playerStatus = (
  token: string,
  payload: { status: string; detail: string; trackId: string; panel: string },
) => apiSend('POST', '/api/player/status', payload, token);

export const ytSearch = (token: string, q: string) =>
  apiSend<{ id: string; title?: string }>(
    'POST',
    `/api/yt-search?q=${encodeURIComponent(q)}`,
    {},
    token,
  );

export const listAudioFiles = (token: string) =>
  apiSend<{ files: string[] }>('POST', '/api/audio-files', {}, token);

export const fetchDjUsers = (token: string) =>
  apiGet<{ users: User[] }>('/api/dj/users', token);

export const resetPassword = (token: string, username: string, passwordBaru: string) =>
  apiSend('POST', '/api/dj/reset-password', { username, passwordBaru }, token);

export const adzanLokasi = (
  token: string,
  payload: {
    latitude: number;
    longitude: number;
    tanggal: string;
    durasi: number;
    enabled: boolean;
  },
) =>
  apiSend<AdzanResponse & { jadwal: Record<string, string> }>('POST', '/api/adzan/lokasi', payload, token);

export const adzanPengaturan = (
  token: string,
  payload: { enabled?: boolean; durasi?: number },
) => apiSend<AdzanResponse>('POST', '/api/adzan/pengaturan', payload, token);
