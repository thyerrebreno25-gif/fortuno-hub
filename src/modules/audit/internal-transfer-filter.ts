import type { AuditMovement } from "./types";

export type CompensatedMovementPair = {
  date: string;
  amount: number;
  entry: AuditMovement;
  exit: AuditMovement;
};

export type InternalTransferFilterResult = {
  auditableMovements: AuditMovement[];
  compensatedMovements: AuditMovement[];
  compensatedPairs: CompensatedMovementPair[];
};

type MovementGroup = {
  entries: AuditMovement[];
  exits: AuditMovement[];
};

function amountInCents(value: number) {
  return Math.round(Math.abs(value) * 100);
}

/**
 * Compensa, um a um, lançamentos de entrada e saída com a mesma data e valor.
 * O pareamento por quantidade evita retirar lançamentos excedentes quando há,
 * por exemplo, duas entradas e somente uma saída correspondente.
 */
export function filterCompensatingMovements(
  movements: AuditMovement[],
  canCompensate: (movement: AuditMovement) => boolean = () => true,
): InternalTransferFilterResult {
  const groups = new Map<string, MovementGroup>();

  for (const movement of movements) {
    if (!canCompensate(movement)) continue;

    const cents = amountInCents(movement.amount);

    if (cents === 0) continue;

    const key = `${movement.date}|${cents}`;
    const group = groups.get(key) ?? { entries: [], exits: [] };

    if (movement.amount > 0) {
      group.entries.push(movement);
    } else if (movement.amount < 0) {
      group.exits.push(movement);
    }

    groups.set(key, group);
  }

  const compensatedPairs: CompensatedMovementPair[] = [];
  const compensated = new Set<AuditMovement>();

  for (const group of groups.values()) {
    const pairCount = Math.min(group.entries.length, group.exits.length);

    for (let index = 0; index < pairCount; index += 1) {
      const entry = group.entries[index];
      const exit = group.exits[index];

      compensated.add(entry);
      compensated.add(exit);
      compensatedPairs.push({
        date: entry.date,
        amount: Math.abs(entry.amount),
        entry,
        exit,
      });
    }
  }

  return {
    auditableMovements: movements.filter((movement) => !compensated.has(movement)),
    compensatedMovements: movements.filter((movement) => compensated.has(movement)),
    compensatedPairs,
  };
}
