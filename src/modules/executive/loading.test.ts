import {expect, it, vi} from "vitest";
import {executiveLoad, executiveQueries} from "./loading";
const deferred = <T,>() => {let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
it("keeps even a large dashboard inside its two-connection budget and retains result order", async () => {
  let active = 0, peak = 0;
  const values = await executiveQueries(Array.from({length: 30}, (_, index) => async () => {
    active++; peak = Math.max(peak, active);
    if (active > 2) throw new Error("timeout exceeded when trying to connect");
    await new Promise(resolve => setTimeout(resolve, index % 3)); active--; return index;
  }));
  expect(values).toEqual(Array.from({length: 30}, (_, index) => index)); expect(peak).toBe(2);
});
it("drains in-flight reads after failure and does not launch the rest of the queries", async () => {
  const gate = deferred<string>(), error = new Error("database unavailable"), later = vi.fn();
  const work = executiveQueries([() => Promise.reject(error), () => gate.promise, later]);
  const observed = work.catch(failure => failure);
  await Promise.resolve(); expect(later).not.toHaveBeenCalled(); gate.resolve("finished");
  expect(await observed).toBe(error); expect(later).not.toHaveBeenCalled();
});
it("coalesces identical cold loads from multiple tabs", async () => {
  const gate = deferred<string>(), load = vi.fn(() => gate.promise);
  const first = executiveLoad("tenant-a:month:permission-set-a", load);
  const second = executiveLoad("tenant-a:month:permission-set-a", load);
  expect(second).toBe(first); await Promise.resolve(); expect(load).toHaveBeenCalledOnce(); gate.resolve("monthly data");
  expect(await first).toBe("monthly data"); expect(await second).toBe("monthly data");
});
it("separates tenants, periods and permissions and serializes their cold database work", async () => {
  const gate = deferred<string>(), next = vi.fn(async () => "different period");
  const first = executiveLoad("tenant-a:month:views-a", () => gate.promise);
  const second = executiveLoad("tenant-b:week:views-b", next);
  await Promise.resolve(); expect(next).not.toHaveBeenCalled(); gate.resolve("first"); await first;
  expect(await second).toBe("different period"); expect(next).toHaveBeenCalledOnce();
});
it("releases failed loads so the next refresh can recover", async () => {
  await expect(executiveLoad("failed-period", async () => {throw new Error("timeout");})).rejects.toThrow("timeout");
  await expect(executiveLoad("failed-period", async () => "recovered")).resolves.toBe("recovered");
});
