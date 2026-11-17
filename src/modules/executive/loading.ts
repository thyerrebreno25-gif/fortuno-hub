/** Keep dashboard fan-out below the two connections in the runtime pool.
 * Queries are lazy: putting already-started Prisma promises in a queue would
 * still exhaust the pool before the queue gets a chance to limit them. */
export async function executiveQueries<const Tasks extends readonly (() => unknown)[]>(tasks: Tasks) {
  const results: unknown[] = new Array(tasks.length);
  let next = 0, failed = false, failure: unknown;
  async function worker() {
    while (!failed && next < tasks.length) {
      const index = next++;
      try {results[index] = await tasks[index]();}
      catch (error) {failed = true; failure = error;}
    }
  }
  await Promise.all(Array.from({length: Math.min(2, tasks.length)}, worker));
  if (failed) throw failure;
  return results as {-readonly [Key in keyof Tasks]: Awaited<ReturnType<Tasks[Key]>>};
}

const pending = new Map<string, Promise<unknown>>();
let tail: Promise<unknown> = Promise.resolve();
/** Share a cold snapshot between tabs and serialize different cold periods.
 * No tenant data is retained here after success/failure; the existing Next
 * cache owns the five-minute snapshot and its full permission/account key. */
export function executiveLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
  const current = pending.get(key);
  if (current) return current as Promise<T>;
  const result = tail.then(load, load);
  pending.set(key, result);
  tail = result.then(() => undefined, () => undefined);
  void result.then(() => pending.delete(key), () => pending.delete(key));
  return result;
}
