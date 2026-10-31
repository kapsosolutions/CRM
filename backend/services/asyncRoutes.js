// Express 4 does not catch errors thrown by async route handlers: a rejected
// promise escapes as an unhandled rejection and Node exits. Many routes await
// the database without a try/catch, so a short network drop to Supabase used
// to take the whole backend down with one failed query.
//
// Every handler Express runs goes through Layer.prototype.handle_request, so
// patching that one function turns a rejected promise into next(err) — a 500
// response — for every route at once. Handlers that already catch their own
// errors behave exactly as before. Import this before the routers.
import Layer from 'express/lib/router/layer.js';

const original = Layer.prototype.handle_request;

Layer.prototype.handle_request = function handleRequestAsyncSafe(req, res, next) {
  const fn = this.handle;
  // Error-handling middleware (4 args) keeps Express's own path.
  if (fn.length > 3) return original.call(this, req, res, next);
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') {
      out.then(undefined, (err) => next(err || new Error('Request failed')));
    }
  } catch (err) {
    next(err);
  }
  return undefined;
};

export default {};
