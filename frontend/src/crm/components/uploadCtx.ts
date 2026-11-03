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
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
  /**
   * After a save: this session's uploads that the saved definition uses are
   * the server's now, so `discard` must leave them alone (the server deletes
   * them when a later save stops using them). `saved` is the saved JSON.
   */
  markSaved: (saved: string) => void;
  /**
   * Leaving the editor: deletes (with `del`) this session's uploads that
   * `stillUsed` (the saved JSON) doesn't contain, and any upload that only
   * finishes after this, since nothing can save it any more.
   */
  leave: (stillUsed: string, del: (url: string) => void) => void;
  /** The editor is (again) open: uploads are kept. Undoes `leave`, for React's dev double mount. */
  open: () => void;
}

const noopMedia: MediaApi = {
  upload: async (file) => URL.createObjectURL(file),
  discard: () => {},
  pending: () => 0,
  saveable: () => true,
  markSaved: () => {},
  leave: () => {},
  open: () => {},
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
  // Set once the editor is left: an upload finishing later is deleted with it.
  let left: ((url: string) => void) | null = null;
  const changed = () => listeners.forEach((fn) => fn());
  return {
    upload: async (file) => {
      inFlight += 1;
      changed();
      try {
        const url = await upload(file);
        if (url && left) {
          left(url);
          return url;
        }
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
    markSaved: (saved) => {
      for (const url of [...session]) if (saved.includes(url)) session.delete(url);
    },
    open: () => {
      left = null;
    },
    leave: (stillUsed, del) => {
      left = del;
      for (const url of [...session]) {
        if (stillUsed.includes(url)) continue;
        session.delete(url);
        del(url);
      }
    },
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

/**
 * Deletes the editor's unsaved uploads when it closes: whatever `saved()` (the
 * saved JSON, read at that moment) doesn't use.
 */
export function useLeaveCleanup(media: MediaApi, saved: () => string, del: (url: string) => void) {
  const latest = useRef({ saved, del });
  latest.current = { saved, del };
  useEffect(() => {
    media.open();
    return () => media.leave(latest.current.saved(), latest.current.del);
  }, [media]);
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
