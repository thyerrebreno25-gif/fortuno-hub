import {expect, it} from "vitest";
import {volumeDistribution} from "./volume";
it("fills every time bucket, aggregates repeated dates and serializes database bigint values", () => {
  const data = volumeDistribution([{weekday: 1, day: 9, hour: 9, count: 7n}, {weekday: 1, day: 16, hour: 9, count: 5n}]);
  expect(data.weekdays).toHaveLength(7); expect(data.monthDays).toHaveLength(31); expect(data.hours).toHaveLength(24);
  expect(data.weekdays[1].value).toBe(12); expect(data.hours[9].value).toBe(12); expect(data.monthDays[8].value).toBe(7);
  expect(data.hours[0].value).toBe(0); expect(() => JSON.stringify(data)).not.toThrow();
});
