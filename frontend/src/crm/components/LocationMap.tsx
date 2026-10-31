// A real map preview for a shared location, the way WhatsApp shows one: the
// streets around the pin with a red marker in the middle.
//
// Built from standard 256px web-map tiles (OpenStreetMap data, CARTO's
// keyless "Voyager" style) positioned so the pin lands in the centre. This
// replaces the old static-map image service, which has been shut down — so
// every location bubble had fallen back to a blank placeholder.
import { useMemo, useState } from 'react';

interface Props {
  lat: number;
  lng: number;
  zoom?: number;
  width?: number;
  height?: number;
}

const TILE = 256;
const SUBDOMAINS = ['a', 'b', 'c', 'd'];

/** World pixel position of a lat/lng at a zoom level (Web Mercator). */
function worldPx(lat: number, lng: number, z: number) {
  const scale = TILE * 2 ** z;
  const x = ((lng + 180) / 360) * scale;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function LocationMap({ lat, lng, zoom = 16, width = 280, height = 150 }: Props) {
  const [failed, setFailed] = useState(0);

  const tiles = useMemo(() => {
    const { x, y } = worldPx(lat, lng, zoom);
    const left = x - width / 2;
    const top = y - height / 2;
    const max = 2 ** zoom;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max; // wrap around the antimeridian
        const sub = SUBDOMAINS[(wx + ty) % SUBDOMAINS.length];
        out.push({
          key: `${tx}_${ty}`,
          src: `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wx}/${ty}.png`,
          x: tx * TILE - left,
          y: ty * TILE - top,
        });
      }
    }
    return out;
  }, [lat, lng, zoom, width, height]);

  const broken = failed > 0 && failed >= tiles.length;

  return (
    <div className="lm-wrap" style={{ height }}>
      {!broken &&
        tiles.map((t) => (
          <img
            key={t.key}
            className="lm-tile"
            src={t.src}
            alt=""
            draggable={false}
            loading="lazy"
            style={{ left: t.x, top: t.y }}
            onError={() => setFailed((n) => n + 1)}
          />
        ))}
      {broken && <div className="lm-fallback" />}
      <span className="material-icons lm-pin">location_on</span>
      <span className="lm-attr">© OpenStreetMap © CARTO</span>
    </div>
  );
}
