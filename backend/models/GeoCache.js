import { Schema, defineModel } from '../db/model.js';

// Reverse-geocoding results, kept so the same spot is never looked up twice.
//
// OpenStreetMap's Nominatim asks every user to cache results and to stay under
// one request a second; a repeat customer ordering from home would otherwise
// cost a lookup on every order. `key` is the pin rounded to 5 decimals (about a
// metre), which is as precise as a delivery needs and lets near-identical
// re-shares of the same pin hit the cache.
const GeoCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String, default: '' }, // short, delivery-friendly form
    displayName: { type: String, default: '' }, // the provider's full string
    // A map picture of the spot, fetched once from Ola and hosted on our CDN,
    // so the CRM never calls Ola from the browser (or twice for one pin).
    mapUrl: { type: String, default: '' },
    provider: { type: String, default: 'nominatim' },
  },
  { timestamps: true },
);

export default defineModel('GeoCache', GeoCacheSchema, 'geo_cache');
