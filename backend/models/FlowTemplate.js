import { Schema, defineModel } from '../db/model.js';

// A reusable flow blueprint shared across tenants.
//
// A business builds a flow it's happy with, saves it as a template, and other
// businesses of the same kind can start a new flow from it instead of building
// from scratch. Templates are deliberately NOT tenant-scoped — that's the whole
// point — but they ARE archetype-scoped: a clinic should see appointment
// templates, not a restaurant's ordering flow. The content is a plain copy of
// a Flow's screens/blocks with every tenant-specific thing stripped out
// (no businessId, no metaFlowId, no published status).
const FlowTemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' }, // "what it's for", shown in the picker

    // Which kind of business this template suits. Filtering is by archetype,
    // not raw category, so every clinic-style vertical shares one pool. The
    // readable category label of the author is kept only for display.
    archetype: { type: String, default: 'catalog', index: true },
    // The exact business category it was made for (e.g. 'restaurant'). Listing
    // is by THIS, not the archetype: a restaurant's ordering flow and a shop's
    // are both "catalog" businesses, but they're different flows, so one
    // shouldn't turn up in the other's template list.
    category: { type: String, default: '', index: true },
    categoryLabel: { type: String, default: '' },

    // Who published it — for attribution and so its author can delete it.
    createdByBusiness: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    createdByName: { type: String, default: '' },
    usedCount: { type: Number, default: 0 },

    // The flow blueprint. Mixed, because the shapes are owned by the Flow model
    // and the builder; this is a verbatim copy, not a second schema to keep in
    // step.
    categories: [{ type: String }], // Meta flow categories, e.g. ['OTHER']
    screens: { type: Schema.Types.Mixed, default: [] },
    blocks: { type: Schema.Types.Mixed, default: [] },
    flowLinks: { type: Schema.Types.Mixed, default: [] },
    entryTarget: { type: String, default: '' },
    positions: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

FlowTemplateSchema.index({ archetype: 1, updatedAt: -1 });

export default defineModel('FlowTemplate', FlowTemplateSchema, 'flow_templates');
