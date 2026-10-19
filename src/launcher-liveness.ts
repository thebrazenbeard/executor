export function watchLauncher(parentPid: number, onGone: () => void, intervalMs = 1000): () => void {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || parentPid === process.pid) throw new Error("invalid launcher PID");
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    try { process.kill(parentPid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
      stopped = true;
      clearInterval(timer);
      onGone();
    }
  }, intervalMs);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
