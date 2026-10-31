// In-memory seed for the native WhatsApp Flow builder (demo mode).
// Mirrors the "Choose Service" flow from the reference (choose.png): an 8:1
// banner, a heading + caption, a radio list of services, and a Continue button.
import type { WaFlowDef } from '../types';

export const demoFlows: WaFlowDef[] = [
  {
    _id: 'f1',
    name: 'Choose Service',
    categories: ['OTHER'],
    cta: 'Choose Service',
    status: 'PUBLISHED',
    metaFlowId: '1449867663672486',
    screens: [
      {
        id: 'CHOOSE_SERVICE',
        title: 'Choose Service',
        components: [
          {
            cid: 'c1',
            type: 'Image',
            src: 'https://picsum.photos/id/1025/1920/240',
          },
          { cid: 'c2', type: 'TextHeading', text: 'Welcome to Himalayan Yoga Academy 🧘' },
          { cid: 'c3', type: 'TextCaption', text: 'Select a service' },
          {
            cid: 'c4',
            type: 'RadioButtonsGroup',
            name: 'selected_service',
            label: 'Services',
            required: true,
            source: 'static',
            // Each option branches to a different screen (endpoint mode).
            options: [
              { id: 'browse', title: 'Browse menu', description: 'See categories', nextScreen: 'MENU_CATEGORIES' },
              { id: 'details', title: 'Register', description: 'Share your details', nextScreen: 'YOUR_DETAILS' },
              { id: 'talk', title: 'Talk to us', description: 'Chat with support', blockId: 'blk_talk' },
            ],
          },
          { cid: 'c5', type: 'Footer', buttonLabel: 'Continue', action: 'complete' },
        ],
      },
      {
        id: 'MENU_CATEGORIES',
        title: 'Browse menu',
        components: [
          { cid: 'm1', type: 'TextSubheading', text: 'Select a category' },
          {
            cid: 'm2',
            type: 'RadioButtonsGroup',
            name: 'selected_category',
            label: 'Categories',
            required: true,
            source: 'categories', // live from the catalog, with 1:1 images
            options: [],
          },
          { cid: 'm3', type: 'Footer', buttonLabel: 'View items', action: 'complete' },
        ],
      },
      {
        id: 'YOUR_DETAILS',
        title: 'Your Details',
        components: [
          { cid: 'c6', type: 'TextHeading', text: 'You chose: ${data.selected_service}' },
          { cid: 'c7', type: 'TextBody', text: 'Share your details and we will get back to you.' },
          { cid: 'c8', type: 'TextInput', name: 'full_name', label: 'Your name', required: true, inputType: 'text' },
          { cid: 'c9', type: 'PhotoPicker', name: 'id_photo', label: 'Upload a photo', photoSource: 'camera_gallery', maxFiles: 1 },
          { cid: 'c10', type: 'DocumentPicker', name: 'id_proof', label: 'Upload ID proof', maxFiles: 1 },
          { cid: 'c11', type: 'Footer', buttonLabel: 'Submit', action: 'complete' },
        ],
      },
    ],
    blocks: [
      {
        id: 'blk_talk',
        kind: 'message',
        text: 'Thanks! Our team will message you shortly. 💬',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

import type { Journey } from '../types';

// A starter chatbot journey (node graph) the Journeys builder loads/saves.
export const demoJourneys: Journey[] = [
  {
    _id: 'j1',
    name: 'Order food',
    nodes: [
      { id: 'start', type: 'wa', position: { x: 60, y: 180 }, data: { kind: 'start' } },
      {
        id: 'welcome',
        type: 'wa',
        position: { x: 320, y: 120 },
        data: { kind: 'message', header: 'image', text: 'Great! Let us take your order 🍽️' },
      },
      {
        id: 'ask',
        type: 'wa',
        position: { x: 620, y: 120 },
        data: { kind: 'reply', header: 'none', text: 'Dine-in or delivery?', buttons: ['Dine-in', 'Delivery'] },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'welcome', animated: true },
      { id: 'e2', source: 'welcome', target: 'ask', animated: true },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
