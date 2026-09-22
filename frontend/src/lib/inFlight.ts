/**
 * Shares one running async operation between concurrent callers using the same key, so two
 * overlapping requests for the same data make one network call instead of two. The entry is
 * removed once the operation settles (success or failure), so later calls start fresh.
 */
export function shareInFlight<T>(store: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const running = store.get(key);
  if (running) return running;
  const promise = run().finally(() => { store.delete(key); });
  store.set(key, promise);
  return promise;
}
