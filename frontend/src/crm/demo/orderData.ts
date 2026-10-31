// In-memory seed for the Orders & bookings page (demo mode).
import type { Order } from '../types';

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const ahead = (h: number) => new Date(now + h * 3600_000).toISOString();

export const demoOrders: Order[] = [
  {
    _id: 'ord1',
    reference: 'ORD-1042',
    kind: 'order',
    customerName: 'Arun Kumar',
    phone: '919876543210',
    items: [
      { name: 'Cold Pressed Groundnut Oil (1 L)', qty: 1, price: 320 },
      { name: 'Organic Jaggery', qty: 2, price: 90 },
    ],
    total: 500,
    status: 'out_for_delivery',
    createdAt: ago(5),
  },
  {
    _id: 'ord2',
    reference: 'ORD-1041',
    kind: 'order',
    customerName: 'Priya S',
    phone: '919812345678',
    items: [{ name: 'Kerala Banana Chips', qty: 3, price: 120 }],
    total: 360,
    status: 'delivered',
    createdAt: ago(28),
  },
  {
    _id: 'ord3',
    reference: 'ORD-1040',
    kind: 'order',
    customerName: 'Mohammed Rafi',
    phone: '919700011122',
    items: [{ name: 'Sun-dried Red Chilli', qty: 1, price: 75 }],
    total: 75,
    status: 'pending',
    createdAt: ago(1),
  },
  {
    _id: 'bkg1',
    reference: 'BKG-220',
    kind: 'booking',
    customerName: 'Divya R',
    phone: '919845612300',
    items: [{ name: 'Yoga Retreat (2 pax)', qty: 2, price: 2500 }],
    total: 5000,
    status: 'confirmed',
    scheduledAt: ahead(48),
    createdAt: ago(10),
  },
  {
    _id: 'bkg2',
    reference: 'BKG-219',
    kind: 'booking',
    customerName: 'Karthik V',
    phone: '919933344455',
    items: [{ name: 'Sound Healing Session', qty: 1, price: 1200 }],
    total: 1200,
    status: 'pending',
    scheduledAt: ahead(72),
    createdAt: ago(3),
  },
];
