import WebSocket from "ws";

export function attachHeartbeat(socket: WebSocket, options: {
  intervalMs?: number; onTimeout?: () => void;
} = {}): () => void {
  const intervalMs = options.intervalMs ?? 15_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("heartbeat interval must be positive");
  let pending = false;
  let timer: NodeJS.Timeout | undefined;
  const pong = () => { pending = false; };
  const cleanup = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    socket.off("open", start);
    socket.off("pong", pong);
    socket.off("close", cleanup);
  };
  const start = () => {
    timer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (pending) {
        cleanup();
        options.onTimeout?.();
        socket.terminate();
        return;
      }
      pending = true;
      socket.ping();
    }, intervalMs);
    timer.unref();
  };
  if (socket.readyState === WebSocket.CLOSED) return cleanup;
  socket.on("pong", pong);
  socket.once("close", cleanup);
  if (socket.readyState === WebSocket.OPEN) start();
  else socket.once("open", start);
  return cleanup;
}
