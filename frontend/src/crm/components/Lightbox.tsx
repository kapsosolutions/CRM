// Full-screen viewer for images and PDFs. Click the backdrop (empty area),
// press Esc, or hit X to close.
import { DownloadIcon } from './AppIcons';
import { useEffect } from 'react';
import { downloadFile } from '../utils';
import { useBackHandler } from '../useBackHandler';

export interface ViewMedia {
  url: string;
  pdf: boolean;
  name?: string;
}

interface Props {
  media: ViewMedia;
  onClose: () => void;
}

export function Lightbox({ media, onClose }: Props) {
  useBackHandler(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lb-close" onClick={onClose} aria-label="Close">
        <span className="material-icons">close</span>
      </button>
      <button
        className="lb-download"
        onClick={(e) => {
          e.stopPropagation();
          downloadFile(media.url, media.name);
        }}
        title="Download"
      >
        <DownloadIcon />
      </button>
      {media.pdf ? (
        <iframe
          className="lb-pdf"
          src={media.url}
          title={media.name || 'PDF'}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img className="lb-img" src={media.url} alt="" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}
