import { Schema, defineModel } from '../db/model.js';

// A generic "member" / person entity a business lists in its flows — e.g. a
// hospital's doctors, a real-estate agency's agents, a salon's stylists. Grouped
// by `category` (a Category name) so a flow can show "members of the chosen
// category" after a category selection. Kept global (like Category) for now.
const MemberSchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    name: { type: String, required: true },
    category: { type: String, default: '' }, // Category name this member belongs to
    title: { type: String, default: '' }, // role / designation (e.g. Cardiologist)
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },

    // ----- Money -----
    // One generic fee whose LABEL comes from the business vertical:
    // "Consultation fee" (hospital), "Price per night" (hotel), "Course fee"…
    fee: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },

    // ----- Bookable (person archetype) -----
    duration: { type: Number, default: 0 }, // slot length in minutes

    /**
     * Per-day working windows.
     *
     * One entry per working day, each carrying its OWN list of time windows,
     * because consulting hours differ by day and by doctor: Monday might be
     * morning + afternoon while Tuesday is morning + afternoon + evening. The
     * gap between two windows is the break — nothing separate to configure.
     *
     * This replaces the single availableFrom/availableTo pair below, which
     * could only describe one unbroken stretch applied to every working day.
     * The old fields are still read once, to migrate existing members.
     */
    schedule: [
      {
        day: { type: String, enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        windows: [
          {
            from: { type: String, default: '' }, // 'HH:MM', 24h
            to: { type: String, default: '' },
            _id: false,
          },
        ],
        _id: false,
      },
    ],

    /**
     * How many patients one slot can hold. A doctor's slot is usually one
     * person, but some clinics deliberately book two or three to a slot, so
     * the hospital sets this rather than us assuming.
     */
    slotCapacity: { type: Number, default: 1 },

    /**
     * Dated absences. `wholeDay` blocks the date outright; otherwise only the
     * from–to range is blocked, so a doctor can lose an afternoon and keep the
     * morning. Separate from `active`, which hides the member indefinitely.
     */
    unavailability: [
      {
        date: { type: String, default: '' }, // 'YYYY-MM-DD'
        wholeDay: { type: Boolean, default: true },
        from: { type: String, default: '' }, // 'HH:MM' when wholeDay is false
        to: { type: String, default: '' },
        reason: { type: String, default: '' },
        // Stamped once the affected patients have been messaged, so saving the
        // member again can't notify the same people twice.
        notifiedAt: { type: Date },
        _id: false,
      },
    ],

    // Legacy single window — superseded by `schedule`, kept so existing
    // members migrate instead of losing their hours.
    availableDays: [{ type: String }], // ['mon','tue',…]
    availableFrom: { type: String, default: '' }, // 'HH:MM'
    availableTo: { type: String, default: '' }, // 'HH:MM'

    // ----- Optional, shown per vertical -----
    experience: { type: Number, default: 0 }, // years
    qualifications: { type: String, default: '' }, // MBBS, MD…
    languages: [{ type: String }],
    location: { type: String, default: '' }, // branch / area
    capacity: { type: Number, default: 0 }, // occupancy (rooms, venues)
    amenities: [{ type: String }], // AC, WiFi, Parking…

    // Anything vertical-specific we haven't modelled yet.
    extras: { type: Schema.Types.Mixed, default: {} },

    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default defineModel('Member', MemberSchema, 'members');
