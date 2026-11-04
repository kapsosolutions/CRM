// The security headers for production. compare.mjs serves the test builds
// with exactly these, and make-nginx.mjs writes them into the nginx snippet,
// so what is tested is what is deployed.
//
// CSP, by directive:
//   script-src   only our own files + the Facebook JS SDK (WhatsApp / Meta
//                connect popups). No inline scripts, no eval. This is the
//                part that stops injected scripts (XSS).
//   style-src    'unsafe-inline' is needed: React style={{}} attributes and
//                the emoji picker's own <style>. Styles can't run code.
//   img/media    https: and blob:/data: — customer photos, template headers,
//                Meta CDN images, map tiles, previews of files being uploaded.
//   connect-src  our API + socket, and https: (map search, Meta SDK calls).
//   frame-src    PDFs/files being previewed (blob:), OpenStreetMap, Meta ad
//                previews and the Facebook login dialog.
//   frame-ancestors 'self'  nobody can put our pages inside their site.
//   Razorpay Checkout (plan payments): its script (checkout.razorpay.com),
//   its window (an https: frame), its calls (https:), and its form posts.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://connect.facebook.net https://checkout.razorpay.com https://*.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.razorpay.com",
  "frame-ancestors 'self'",
].join('; ');

// On every response (pages, files and the API).
export const SECURITY_HEADERS = {
  // Browsers that have seen the site once use HTTPS only, for a year.
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Microphone: voice notes and WhatsApp calls. Camera: the chat's + → Camera.
  // Location: "use my location" in the location picker. Payment: Razorpay
  // Checkout's window (UPI apps, saved cards). USB etc. are never used.
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=(), serial=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=()',
};
