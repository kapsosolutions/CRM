// Media plumbing for the journey/flow builders.
//
// `upload` stores a File and returns a hosted URL (Bunny CDN in real mode, an
// object URL in demo). `discard` removes a file that is no longer referenced.
//
// Why discard is conditional: the builders hold unsaved state. If a user picks
// image A, then replaces it with B, then hits Discard, the definition on the
// server still points at A — so A must NOT be deleted. We therefore only delete
// files uploaded during *this* editing session (which the server has never been
// told about). Media that was already saved is cleaned up server-side when the
// definition is saved without it (see routes/flows.js + routes/journeys.js).
//
// Uploads in flight are counted (`pending` / usePendingUploads), so an editor
// can hold Save until every picked file has its hosted URL. Saving earlier
// stores the instant-preview `blob:` address, which only exists in that tab.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type UploadFn = (file: File) => Promise<string>;
export type DeleteFn = (url: string) => Promise<unknown>;

export interface MediaApi {
  upload: UploadFn;
  /** Delete `url` if it was uploaded in this session; otherwise a no-op. */
  discard: (url?: string) => void;
  /** Uploads still running. */
  pending: () => number;
  /**
   * Whether `url` can be saved: a hosted address, or one `upload` returned (in
   * demo mode uploads are object URLs). False for an instant-preview `blob:`
   * whose upload never finished.
   */
  saveable: (url: string) => boolean;
  /** Called whenever `pending` changes; returns the unsubscribe. */
  subscribe: (fn: () => void) => () => void;
}

const noopMedia: MediaApi = {
  upload: async (file) => URL.createObjectURL(file),
  discard: () => {},
  pending: () => 0,
  saveable: () => true,
  subscribe: () => () => {},
};

export const MediaCtx = createContext<MediaApi>(noopMedia);
export const useMedia = () => useContext(MediaCtx);

/** Back-compat: components that only need to upload. */
export const useUpload = (): UploadFn => useContext(MediaCtx).upload;

/** Build a MediaApi that tracks this session's uploads so they can be reclaimed. */
export function createMediaApi(upload: UploadFn, remove?: DeleteFn): MediaApi {
  const session = new Set<string>();
  // Every address `upload` handed back (kept after discard, unlike `session`).
  const returned = new Set<string>();
  const listeners = new Set<() => void>();
  let inFlight = 0;
  const changed = () => listeners.forEach((fn) => fn());
  return {
    upload: async (file) => {
      inFlight += 1;
      changed();
      try {
        const url = await upload(file);
        if (url) {
          session.add(url);
          returned.add(url);
        }
        return url;
      } finally {
        inFlight -= 1;
        changed();
      }
    },
    discard: (url) => {
      if (!url || !session.has(url)) return; // never-uploaded or already persisted
      session.delete(url);
      remove?.(url).catch(() => {});
    },
    pending: () => inFlight,
    saveable: (url) => !url.startsWith('blob:') || returned.has(url),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** Hook form of createMediaApi, stable for the life of the editor. */
export function useMediaApi(upload: UploadFn, remove?: DeleteFn): MediaApi {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createMediaApi(upload, remove), []);
}

/** How many uploads `media` still has running (re-renders when it changes). */
export function usePendingUploads(media: MediaApi): number {
  const [n, setN] = useState(media.pending());
  useEffect(() => {
    setN(media.pending());
    return media.subscribe(() => setN(media.pending()));
  }, [media]);
  return n;
}
