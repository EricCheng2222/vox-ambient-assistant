/** At most one encrypted progress write at a time. Progress is disposable;
 * the existing retried final-result write remains responsible for delivery.
 */
export function createTaskEventRelay(send, { intervalMs = 1_000, startAck } = {}) {
  // Older servers interpret every non-start PATCH as final completion.
  // Never send progress unless pickup explicitly advertises this protocol.
  const enabled = startAck?.taskEvents === 1;
  const events = [];
  let timer;
  let pending = false;
  let stopped = false;
  let busy = false;
  let writing = Promise.resolve();
  const flush = () => {
    if (stopped || !pending || busy) return;
    pending = false;
    busy = true;
    const snapshot = events.slice(-12);
    writing = writing.then(() => send(snapshot)).catch(() => undefined).finally(() => {
      busy = false;
      if (!stopped && pending && !timer) timer = setTimeout(() => { timer = undefined; flush(); }, intervalMs);
    });
  };
  return {
    events,
    emit(event) {
      if (stopped) return;
      events.push(event);
      if (events.length > 64) events.shift();
      if (!enabled) return;
      pending = true;
      if (!timer && !busy) timer = setTimeout(() => { timer = undefined; flush(); }, intervalMs);
    },
    async close() {
      stopped = true;
      clearTimeout(timer);
      // Await the last progress write so it cannot overwrite the final result.
      await writing;
    },
  };
}
