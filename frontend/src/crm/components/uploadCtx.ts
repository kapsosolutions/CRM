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
import { createContext, useContext, useMemo } from 'react';

export type UploadFn = (file: File) => Promise<string>;
export type DeleteFn = (url: string) => Promise<unknown>;

export interface MediaApi {
  upload: UploadFn;
  /** Delete `url` if it was uploaded in this session; otherwise a no-op. */
  discard: (url?: string) => void;
}

const noopMedia: MediaApi = {
  upload: async (file) => URL.createObjectURL(file),
  discard: () => {},
};

export const MediaCtx = createContext<MediaApi>(noopMedia);
export const useMedia = () => useContext(MediaCtx);

/** Back-compat: components that only need to upload. */
export const useUpload = (): UploadFn => useContext(MediaCtx).upload;

/** Build a MediaApi that tracks this session's uploads so they can be reclaimed. */
export function createMediaApi(upload: UploadFn, remove?: DeleteFn): MediaApi {
  const session = new Set<string>();
  return {
    upload: async (file) => {
      const url = await upload(file);
      if (url) session.add(url);
      return url;
    },
    discard: (url) => {
      if (!url || !session.has(url)) return; // never-uploaded or already persisted
      session.delete(url);
      remove?.(url).catch(() => {});
    },
  };
}

/** Hook form of createMediaApi, stable for the life of the editor. */
export function useMediaApi(upload: UploadFn, remove?: DeleteFn): MediaApi {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createMediaApi(upload, remove), []);
}


