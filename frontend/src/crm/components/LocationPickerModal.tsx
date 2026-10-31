import { useState, useEffect } from 'react';
import { LocationMap } from './LocationMap';
import './LocationPickerModal.css';

interface LocationSearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialAddress: string;
  initialLat?: number;
  initialLng?: number;
  onSave: (address: string, lat: number, lng: number) => void;
}

// Popular city fallbacks
const POPULAR_LOCATIONS = [
  { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Nellore', lat: 14.4426, lng: 79.9865 },
];

export function LocationPickerModal({
  isOpen,
  onClose,
  initialAddress,
  initialLat = 28.6448, // Default to Delhi area matching screenshot
  initialLng = 77.1215,
  onSave,
}: LocationPickerModalProps) {
  const [address, setAddress] = useState(initialAddress);
  const [searchQuery, setSearchQuery] = useState('');
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [zoom, setZoom] = useState(15);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [locating, setLocating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAddress(initialAddress || '');
      setSearchQuery('');
      setResults([]);
      setErrorMsg('');
      if (initialLat && initialLng) {
        setLat(initialLat);
        setLng(initialLng);
      }
    }
  }, [isOpen, initialAddress, initialLat, initialLng]);

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSearching(true);
    setErrorMsg('');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data: LocationSearchResult[] = await res.json();
      if (data && data.length > 0) {
        setResults(data);
      } else {
        setErrorMsg(`No locations found for "${q}". Try another search term.`);
        setResults([]);
      }
    } catch {
      setErrorMsg('Could not search location. Please check internet connection.');
    } finally {
      setSearching(false);
    }
  };

  const selectSearchResult = (item: LocationSearchResult) => {
    const newLat = parseFloat(item.lat);
    const newLng = parseFloat(item.lon);
    setLat(newLat);
    setLng(newLng);
    setAddress(item.display_name);
    setResults([]);
    setSearchQuery('');
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      return;
    }

    setLocating(true);
    setErrorMsg('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const curLat = pos.coords.latitude;
        const curLng = pos.coords.longitude;
        setLat(curLat);
        setLng(curLng);
        setLocating(false);

        // Reverse geocode to get address
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${curLat}&lon=${curLng}`
          );
          const data = await res.json();
          if (data && data.display_name) {
            setAddress(data.display_name);
          }
        } catch {
          // ignore
        }
      },
      (err) => {
        setLocating(false);
        setErrorMsg(err.message || 'Could not fetch your current location.');
      },
      { timeout: 10000 }
    );
  };

  const handleSave = () => {
    onSave(address.trim(), lat, lng);
    onClose();
  };

  return (
    <div className="lpm-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lpm-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lpm-header">
          <div className="lpm-header-text">
            <h3 className="lpm-title">Set business location on map</h3>
            <p className="lpm-sub">Search for your business address to place a pin on WhatsApp.</p>
          </div>
          <button type="button" className="lpm-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Search Bar */}
        <form className="lpm-search-box" onSubmit={handleSearch}>
          <div className="lpm-input-wrap">
            <span className="material-icons lpm-search-icon">search</span>
            <input
              type="text"
              className="lpm-search-input"
              placeholder="Search area, landmark, street or city…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="lpm-clear-btn"
                onClick={() => {
                  setSearchQuery('');
                  setResults([]);
                }}
              >
                ✕
              </button>
            )}
          </div>
          <button type="submit" className="lpm-search-submit-btn" disabled={searching || !searchQuery.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            className="lpm-gps-btn"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            title="Use current GPS location"
          >
            <span className="material-icons">my_location</span>
            <span>{locating ? 'Locating…' : 'Current location'}</span>
          </button>
        </form>

        {/* Search Results Dropdown List */}
        {results.length > 0 && (
          <div className="lpm-results-list">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                className="lpm-result-item"
                onClick={() => selectSearchResult(r)}
              >
                <span className="material-icons lpm-result-icon">place</span>
                <span className="lpm-result-name">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {errorMsg && <div className="lpm-error-banner">{errorMsg}</div>}

        {/* Quick City Chips */}
        <div className="lpm-chips-row">
          <span className="lpm-chips-label">Quick select:</span>
          {POPULAR_LOCATIONS.map((loc) => (
            <button
              key={loc.name}
              type="button"
              className="lpm-chip"
              onClick={() => {
                setLat(loc.lat);
                setLng(loc.lng);
                setAddress(`${loc.name}, India`);
              }}
            >
              {loc.name}
            </button>
          ))}
        </div>

        {/* Map Preview Canvas */}
        <div className="lpm-map-wrapper">
          <LocationMap lat={lat} lng={lng} zoom={zoom} width={500} height={240} />
          <div className="lpm-zoom-controls">
            <button
              type="button"
              className="lpm-zoom-btn"
              onClick={() => setZoom((z) => Math.min(18, z + 1))}
              title="Zoom In"
            >
              +
            </button>
            <button
              type="button"
              className="lpm-zoom-btn"
              onClick={() => setZoom((z) => Math.max(10, z - 1))}
              title="Zoom Out"
            >
              −
            </button>
          </div>
          <div className="lpm-pin-hint">
            <span className="material-icons">touch_app</span>
            <span>Location pin centered</span>
          </div>
        </div>

        {/* Confirmed Address Input */}
        <div className="lpm-address-field">
          <label className="lpm-address-label">Selected Address text:</label>
          <input
            type="text"
            className="lpm-address-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Tagore Garden, Delhi, India"
          />
        </div>

        {/* Footer Actions */}
        <div className="lpm-footer">
          <button type="button" className="lpm-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="lpm-btn-primary" onClick={handleSave}>
            Confirm location
          </button>
        </div>
      </div>
    </div>
  );
}

export default LocationPickerModal;
