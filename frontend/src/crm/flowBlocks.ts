// The map blocks a flow can hand off to, with their starting wording. Shared by
// the Flow builder (dragging a block onto the map) and the ready-made flow
// templates (flowTemplates.ts), so a template's blocks start out exactly like
// hand-placed ones.
import type { FlowBlock, FlowBlockHeader, FlowBlockKind } from './types';
import { verticalConfig, type ConfirmWording } from './verticals';
import { confirmPdfTemplate } from './components/PdfDesigner';

export interface BlockSpec {
  kind: FlowBlockKind;
  buttons?: number;
  header?: FlowBlockHeader;
  // Which document a 'pdfdoc' block starts from. Cancellations and order
  // confirmations are both A4 slips but say opposite things, so each gets its
  // own palette entry and its own seeded template.
  preset?: 'cancel' | 'confirm';
}

/** Fallback wording when no vertical is known (standalone / demo use). */
const DEFAULT_CONFIRM = verticalConfig('other').confirm;

let blkSeq = 1;
export function makeBlock(spec: BlockSpec, wording: ConfirmWording = DEFAULT_CONFIRM): FlowBlock {
  const id = `blk_${Date.now().toString(36)}_${blkSeq++}`;
  const b: FlowBlock = { id, kind: spec.kind, header: spec.header || 'none', text: '' };
  switch (spec.kind) {
    case 'message':
      b.text = 'Thanks! We will be in touch shortly.';
      break;
    case 'reply':
      b.text = 'How can we help?';
      b.buttons = Array.from({ length: spec.buttons || 1 }, (_, i) => `Button ${i + 1}`);
      break;
    // Same wire as 'reply', only the wording and buttons start off as a
    // payment question. The costed Items / Delivery / Total payable summary is
    // generated at send time and sits above this text, so all that's stored
    // here is the prompt. Both button labels are editable in the node.
    case 'paymethod':
      b.text = 'Select an option below to confirm.';
      b.buttons = ['Online', 'COD'];
      b.deliveryFee = 0;
      b.showSummary = true;
      b.summaryTitle = 'Payment';
      break;
    case 'cta':
      b.text = 'Check this out';
      b.ctaLabel = 'Open';
      b.ctaUrl = 'https://';
      break;
    case 'call':
      b.text = 'Call us';
      b.callLabel = 'Call';
      b.callPhone = '+91';
      break;
    case 'location':
      b.text = 'Please share your location.';
      break;
    case 'list':
      b.text = 'Choose an option';
      b.listTitle = 'Menu';
      b.options = ['Option 1', 'Option 2'];
      break;
    case 'template':
      b.templateName = '';
      break;
    case 'payment':
      b.text = 'Review your items and pay securely via UPI.';
      b.currency = 'INR';
      break;
    case 'catalog':
      b.text = 'Browse our products. Tap a product for full details, ratings & to add to cart.';
      b.ctaLabel = 'View items';
      break;
    // Everything the conversation captured, in one message. Lines whose live
    // value is empty are dropped at send time, which is what makes the same
    // default work for a delivery business and a walk-in one.
    case 'orderconfirm':
      // Wording comes from the business type: a clinic confirms an appointment
      // with a doctor and a time, a shop confirms a cart with a delivery
      // address. Label-and-colon rather than padded columns, because runs of
      // spaces are collapsed when the live values are filled in.
      b.text = wording.body;
      b.buttons = [];
      break;
    // Reports the record the customer picked earlier. Same rule: a line with no
    // value doesn't get sent, so a business that never records a payment
    // status won't show an empty one.
    case 'orderdetails':
      b.text = wording.detailsBody;
      b.buttons = ['Start'];
      break;
    case 'pdfdoc':
      // One message: the generated PDF, the wording, and reply buttons.
      if (spec.preset === 'confirm') {
        b.text = wording.pdfText;
        b.buttons = ['Start'];
        b.pdfFileName = wording.pdfFileName;
        // The slip layout follows the business type too — a clinic's has no
        // cart, no delivery address and no totals.
        b.pdfTemplate = { ...confirmPdfTemplate(wording.pdf), design: 'classic', slip: 'confirm' };
      } else {
        // The cancellation slip. Wording follows the business type too — a
        // clinic cancels an appointment, not an order — and it reuses the
        // confirm slip layout with its own heading and note.
        const c = wording.cancel;
        b.text = c.docText;
        b.buttons = ['Start'];
        b.pdfFileName = c.pdfFileName;
        b.pdfTemplate = { ...confirmPdfTemplate({ ...wording.pdf, title: c.pdfTitle, note: c.pdfNote }), design: 'classic', slip: 'cancel' };
      }
      break;
  }
  return b;
}
