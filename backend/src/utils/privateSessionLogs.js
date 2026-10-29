// libsignal writes entire session objects (including key material) directly to
// console, bypassing Baileys' logger. Keep the event, never its session payload.
const SESSION_EVENTS = new Set([
  'Closing session:', 'Opening session:', 'Removing old closed session:',
  'Session already closed', 'Unhandled bucket type (for naming):',
]);
const installed = Symbol.for('sj.privateSessionLogs');
function protectSessionLogs(target = console) {
  if (target[installed]) return;
  for (const method of ['info', 'warn', 'log']) {
    const original = target[method].bind(target);
    target[method] = (...args) => original(...(SESSION_EVENTS.has(args[0])
      ? [args[0], '[private session details omitted]'] : args));
  }
  target[installed] = true;
}
module.exports = { protectSessionLogs };
