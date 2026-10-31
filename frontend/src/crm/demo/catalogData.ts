// In-memory catalog seed for demo mode (products + categories + offers).
import type { Product, Category, Offer } from '../types';

export const demoCategories: Category[] = [
  { _id: 'c1', name: 'Oils', order: 1 },
  { _id: 'c2', name: 'Sweeteners', order: 2 },
  { _id: 'c3', name: 'Spices', order: 3 },
  { _id: 'c4', name: 'Snacks', order: 4 },
];

export const demoProducts: Product[] = [
  {
    _id: 'p1',
    retailerId: 'cold_pressed_groundnut_oil',
    name: 'Cold Pressed Groundnut Oil',
    description: 'Traditional wood-pressed groundnut oil. No preservatives.',
    categories: ['Oils'],
    price: 320,
    mrp: 380,
    unit: 'bottle',
    imageUrl: 'https://picsum.photos/id/1080/400/400',
    inStock: true,
    active: true,
    isPaused: false,
    catalogSynced: true,
    variants: [
      { label: '500 ml', quantity: 500, unit: 'ml', price: 180 },
      { label: '1 L', quantity: 1, unit: 'L', price: 320 },
    ],
  },
  {
    _id: 'p2',
    retailerId: 'organic_jaggery',
    name: 'Organic Jaggery',
    description: 'Chemical-free sugarcane jaggery blocks.',
    categories: ['Sweeteners'],
    price: 90,
    unit: 'pack',
    quantity: 500,
    imageUrl: 'https://picsum.photos/id/431/400/400',
    inStock: true,
    active: true,
    isPaused: false,
    catalogSynced: true,
  },
  {
    _id: 'p3',
    retailerId: 'sun_dried_red_chilli',
    name: 'Sun-dried Red Chilli',
    description: 'Premium Guntur red chillies, naturally sun-dried.',
    categories: ['Spices'],
    price: 75,
    unit: 'pack',
    quantity: 250,
    imageUrl: 'https://picsum.photos/id/326/400/400',
    inStock: true,
    active: true,
    isPaused: true, // paused example
    catalogSynced: true,
  },
  {
    _id: 'p4',
    retailerId: 'banana_chips',
    name: 'Kerala Banana Chips',
    description: 'Crispy coconut-oil fried banana chips.',
    categories: ['Snacks'],
    price: 120,
    unit: 'pack',
    quantity: 200,
    imageUrl: 'https://picsum.photos/id/1060/400/400',
    inStock: true,
    active: true,
    isPaused: false,
    catalogSynced: false, // not yet synced example
    soldOutSchedule: {
      enabled: true,
      type: 'daily',
      dailyStartTime: '09:00',
      dailyEndTime: '21:00',
    },
  },
];

export const demoOffers: Offer[] = [
  {
    _id: 'o1',
    title: 'Groundnut Oil — Festive Deal',
    active: true,
    items: [
      {
        productId: 'p1',
        productName: 'Cold Pressed Groundnut Oil',
        productImageUrl: 'https://picsum.photos/id/1080/400/400',
        variantIndex: 0,
        subIndex: -1, // the whole size
        label: '500 ml',
        originalPrice: 180,
        discountType: 'percent',
        discountValue: 10,
        offerPrice: 162,
      },
      {
        productId: 'p1',
        productName: 'Cold Pressed Groundnut Oil',
        productImageUrl: 'https://picsum.photos/id/1080/400/400',
        variantIndex: 1,
        subIndex: -1,
        label: '1 L',
        originalPrice: 320,
        discountType: 'flat',
        discountValue: 40,
        offerPrice: 280,
      },
    ],
    createdAt: new Date().toISOString(),
  },
];
