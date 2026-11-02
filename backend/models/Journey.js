import { Schema, defineModel } from '../db/model.js';

// A saved chatbot "journey" — the node/edge graph built in the Journeys canvas.
// Stored loosely (Mixed) since the graph shape is owned by the frontend builder.
const JourneySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    name: { type: String, required: true },
    nodes: { type: [Schema.Types.Mixed], default: [] },
    edges: { type: [Schema.Types.Mixed], default: [] },
    // No longer read: a saved journey always runs (journeyRuntime.pickJourney).
    active: { type: Boolean, default: true },
    // '' (or missing, older rows) = WhatsApp; 'instagram' | 'messenger' run on
    // those chats (services/channelJourney.js). One journey per channel is used.
    channel: { type: String, default: '' },
  },
  { timestamps: true, minimize: false },
);

export default defineModel('Journey', JourneySchema, 'journeys');
