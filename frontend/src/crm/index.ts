// =============================================================================
// Reusable WhatsApp CRM module — public API.
//
// In any React project: copy the `src/crm` folder, ensure the WhatsApp design
// tokens (styles/tokens.css) and Material Icons font are loaded, then:
//
//   import { CrmApp } from './crm';
//   <CrmApp config={{ apiBase: 'https://your-backend' }} />
// =============================================================================
export { CrmShell } from './components/CrmShell';
export { CrmApp } from './components/CrmApp';
export { CrmApi } from './api';
export { CrmSocket } from './socket';
export { defaultConfig } from './config';
export type { CrmConfig } from './config';
export * from './types';
export { phoneToIso, phoneToFlagUrl } from './countryFlag';
export { CountryFlag } from './components/CountryFlag';
