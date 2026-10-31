// Contact avatar: customer profile icon in gray with channel badge (WhatsApp,
// Instagram, Messenger, Facebook) matching Channel Status.
export type Channel = 'whatsapp' | 'instagram' | 'messenger' | 'facebook';

const LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  facebook: 'Facebook',
};

/** Official channel icons matching Channel Status */
function ChannelGlyph({ channel }: { channel: Channel }) {
  switch (channel) {
    case 'instagram':
      return <img src="/channel-instagram.svg" alt="Instagram" className="ch-icon-img" />;
    case 'messenger':
      return <img src="/channel-messenger.svg" alt="Messenger" className="ch-icon-img" />;
    case 'facebook':
      return <img src="/channel-messenger.svg" alt="Facebook" className="ch-icon-img" />;
    default:
      return <img src="/whatsapp.svg" alt="WhatsApp" className="ch-icon-img" />;
  }
}

/** User-requested contact profile icon */
export function ContactProfileIcon({ width = 22, height = 22, className }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="6" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 17C3.5 13.9624 5.96243 11.5 9 11.5H11C14.0376 11.5 16.5 13.9624 16.5 17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DefaultAvatar({ channel, photoUrl }: { channel?: Channel | string; photoUrl?: string } = {}) {
  const ch: Channel | null = channel && channel in LABEL ? (channel as Channel) : null;
  return (
    <div className={`avatar default-avatar${ch ? ` ch-${ch}` : ''}`} title={ch ? `Via ${LABEL[ch]}` : undefined}>
      {photoUrl ? (
        // A Messenger / Instagram profile photo, when Meta shares one.
        <img src={photoUrl} alt="" className="contact-avatar-img contact-avatar-photo" draggable={false} />
      ) : (
        <img src="/icon-avatar.svg" alt="Avatar" className="contact-avatar-img" draggable={false} />
      )}
      {ch && (
        <span className="ch-badge" aria-label={`Via ${LABEL[ch]}`}>
          <ChannelGlyph channel={ch} />
        </span>
      )}
    </div>
  );
}

