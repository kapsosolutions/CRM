// Shared SVG icons (undo, redo, copy, download, crop-rotate, draw, blur…).
//
// Every icon carries the `material-icons` class, so it picks up the same
// font-size (24px by default, or whatever the surrounding CSS sets for
// `.something .material-icons`) as the font icons it replaces: width and
// height are 1em. Pass `size` to pin a pixel size instead.
import type { CSSProperties, ReactNode } from 'react';
import './AppIcons.css';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

function Svg({ size, className, style, title, children, testId }: IconProps & { children: ReactNode; testId: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? '1em'}
      height={size ?? '1em'}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={`material-icons app-ico${className ? ` ${className}` : ''}`}
      style={size ? { ...style, fontSize: size } : style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      data-icon={testId}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export function UndoIcon(p: IconProps) {
  return (
    <Svg {...p} testId="undo">
      <path d="M8 19a.97.97 0 0 1-.71-.29A.97.97 0 0 1 7 18c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29h6.1c1.05 0 1.96-.33 2.74-1A3.16 3.16 0 0 0 18 13.5c0-1-.39-1.83-1.16-2.5-.78-.67-1.69-1-2.74-1H7.8l1.9 1.9c.18.18.27.42.27.7 0 .28-.09.52-.27.7a.95.95 0 0 1-.7.27.95.95 0 0 1-.7-.27L4.7 9.7a.88.88 0 0 1-.21-.32A1.1 1.1 0 0 1 4.42 9c0-.13.03-.26.07-.37a.88.88 0 0 1 .21-.33l3.6-3.6a.95.95 0 0 1 .7-.27c.28 0 .52.09.7.27.18.18.27.42.27.7 0 .28-.09.52-.27.7L7.8 8h6.3c1.62 0 3 .53 4.16 1.58A5.08 5.08 0 0 1 20 13.5c0 1.57-.58 2.88-1.74 3.93A5.98 5.98 0 0 1 14.1 19H8Z" />
    </Svg>
  );
}

export function RedoIcon(p: IconProps) {
  return (
    <Svg {...p} testId="redo">
      <path d="M16.2 10H9.9c-1.05 0-1.96.33-2.74 1A3.16 3.16 0 0 0 6 13.5c0 1 .39 1.83 1.16 2.5.78.67 1.69 1 2.74 1H16c.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 16 19H9.9c-1.62 0-3-.52-4.16-1.57A5.08 5.08 0 0 1 4 13.5c0-1.57.58-2.88 1.74-3.92A5.98 5.98 0 0 1 9.9 8h6.3l-1.9-1.9a.95.95 0 0 1-.28-.7.95.95 0 0 1 .97-.98c.3 0 .53.1.71.28l3.6 3.6c.1.1.17.2.21.33a1.2 1.2 0 0 1 0 .75.88.88 0 0 1-.21.32l-3.6 3.6a.95.95 0 0 1-.7.27.95.95 0 0 1-.7-.27.95.95 0 0 1-.28-.7c0-.28.1-.52.28-.7l1.9-1.9Z" />
    </Svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p} testId="copy">
      <path d="M5 22c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V7c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v13h10c.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 15 22H5Zm4-4c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V4c0-.55.2-1.02.59-1.41C7.98 2.19 8.45 2 9 2h9c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41v12c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H9Zm0-2h9V4H9v12Z" />
    </Svg>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p} testId="download">
      <path d="M12 15.57a1.1 1.1 0 0 1-.38-.06.88.88 0 0 1-.32-.21l-3.6-3.6a.92.92 0 0 1-.29-.7 1.03 1.03 0 0 1 1-1.01c.28-.01.52.08.71.29L11 12.14V5c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v7.15l1.88-1.88c.2-.2.43-.3.7-.28a1.02 1.02 0 0 1 1 1.01c.02.27-.08.5-.28.7l-3.6 3.6a.8.8 0 0 1-.32.21 1.1 1.1 0 0 1-.38.06ZM6 20c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41v-2c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v2h12v-2c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v2c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6Z" />
    </Svg>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <Svg {...p} testId="edit">
      <path d="M5 19h1.4l9.8-9.78-1.42-1.42L5 17.6V19Zm-1 2a.97.97 0 0 1-.71-.29A.97.97 0 0 1 3 20v-2.43a1.98 1.98 0 0 1 .58-1.4L16.2 3.57a2.07 2.07 0 0 1 2.19-.42c.24.1.46.25.66.45L20.43 5c.2.18.34.4.43.64a2.13 2.13 0 0 1 0 1.51c-.09.25-.23.47-.43.67l-12.6 12.6a1.94 1.94 0 0 1-1.4.58H4Z" />
    </Svg>
  );
}

export function PixelateIcon(p: IconProps) {
  return (
    <Svg {...p} testId="blur-pixelate">
      <path d="M4.5 4.5h3v3h-3zm0 6h3v3h-3zm0 6h3v3h-3zm3-9h3v3h-3zm0 6h3v3h-3zm6-6h3v3h-3zm0 6h3v3h-3zm-3-9h3v3h-3zm0 6h3v3h-3zm0 6h3v3h-3zm6-12h3v3h-3zm0 6h3v3h-3zm0 6h3v3h-3z" />
    </Svg>
  );
}

// Crop-rotate and blur-on: Material Symbols glyphs of the same names.
export function CropRotateIcon(p: IconProps) {
  return (
    <Svg {...p} testId="crop-rotate">
      <path d="M7.47 21.49C4.2 19.93 1.86 16.76 1.5 13H0c.51 6.16 5.66 11 11.95 11l.66-.03-3.81-3.81-1.33 1.33zM12.05 0l-.66.03 3.81 3.81 1.33-1.33c3.27 1.55 5.61 4.72 5.96 8.48h1.5C23.49 4.84 18.34 0 12.05 0zM16 14h2V8c0-1.11-.9-2-2-2h-6v2h6v6zm-8 2V4H6v2H4v2h2v8c0 1.1.89 2 2 2h8v2h2v-2h2v-2H8z" />
    </Svg>
  );
}

export function BlurIcon(p: IconProps) {
  return (
    <Svg {...p} testId="blur-on">
      <path d="M6 13c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0-8c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm-3 .5c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zM6 5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm15 5.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5-.5.22-.5.5.22.5.5.5zM14 7c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm0-3.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5-.5.22-.5.5.22.5.5.5zm-11 10c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zm7 7c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zm0-17c.28 0 .5-.22.5-.5s-.22-.5-.5-.5-.5.22-.5.5.22.5.5.5zM10 7c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm0 5.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm8 .5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0-8c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0-4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm3 8.5c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zM14 17c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0 3.5c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zm-4-12c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0 8.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm4-4.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-4c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z" />
    </Svg>
  );
}

/**
 * Drop-in for `<span className="material-icons">{name}</span>` where the icon
 * name comes from data: the names above render as SVG, anything else stays a
 * font icon.
 */
export function AppIcon({ name, ...p }: IconProps & { name: string }) {
  switch (name) {
    case 'undo': return <UndoIcon {...p} />;
    case 'redo': return <RedoIcon {...p} />;
    case 'content_copy': return <CopyIcon {...p} />;
    case 'download':
    case 'file_download': return <DownloadIcon {...p} />;
    case 'crop_rotate': return <CropRotateIcon {...p} />;
    default:
      return (
        <span className={`material-icons${p.className ? ` ${p.className}` : ''}`} style={p.size ? { ...p.style, fontSize: p.size } : p.style} aria-hidden="true">
          {name}
        </span>
      );
  }
}
