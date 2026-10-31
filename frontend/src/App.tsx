// Host for the multi-tenant WhatsApp CRM.
//   (default)  demo CRM — explore with in-memory data, no backend
//   #/admin    super-admin businesses panel
//   #/login    business login → real CRM for that tenant
import { AdminApp } from './admin/AdminApp';
import { DialogProvider } from './crm/components/Dialogs';
import './App.css';

export function App() {
  return (
    <main className="app-main">
      {/* Confirm dialogs + top-right toasts for every page (CRM and admin). */}
      <DialogProvider>
        <AdminApp />
      </DialogProvider>
    </main>
  );
}
