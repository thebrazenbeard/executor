import WebSocket from "ws";

export interface ConnectionHeartbeatOptions {
  intervalMs?: number;
  onTimeout?: () => void;
}

/** Probe an open WebSocket, terminate silent peers, and clean up on close. */
export function attachConnectionHeartbeat(
  socket: WebSocket,
  options: ConnectionHeartbeatOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? 15_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("heartbeat intervalMs must be positive and finite");
  }

  let awaitingPong = false;
  let timer: NodeJS.Timeout | undefined;
  let closingTicks = 0;

  const onPong = () => { awaitingPong = false; };
  const onClose = () => { stop(); };
  const tick = () => {
    if (socket.readyState === WebSocket.CLOSING) {
      if (++closingTicks >= 2) socket.terminate();
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    closingTicks = 0;
    if (awaitingPong) {
      options.onTimeout?.();
      socket.terminate();
      return;
    }
    awaitingPong = true;
    socket.ping();
  };
  const start = () => {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    timer.unref();
  };
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    socket.off("open", start);
    socket.off("pong", onPong);
    socket.off("close", onClose);
  }

  socket.on("pong", onPong);
  socket.on("close", onClose);
  if (socket.readyState === WebSocket.OPEN) start();
  else socket.once("open", start);
  return stop;
}
