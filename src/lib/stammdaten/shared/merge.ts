import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";

import type { FkRewire, MergeAdapter, Tx } from "./types.ts";

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeError";
  }
}

export type MergeResult<Row> = {
  winner: Row;
  deletedIds: number[];
};

export type MergeOptions = {
  /**
   * Loser ids that should be REPLACED (FK refs rewired to the winner, row
   * deleted) without absorbing the loser's canonical name / aliases as new
   * aliases of the winner. Use this when the loser was clearly an erroneous
   * row and the user doesn't want the name preserved.
   *
   * Ids not in this set get the default merge treatment (name + aliases
   * become aliases of the winner).
   */
  replaceIds?: number[];
};

/**
 * Generic merge transaction. Loads winner + losers, calls adapter validators,
 * absorbs loser names + aliases into the winner's alias table (when one
 * exists), runs the adapter's customRewires (composite-PK dedupe), then the
 * straightforward bulk FK rewires, calls postProcess, deletes losers, returns
 * the updated winner.
 *
 * All steps run inside one synchronous better-sqlite3 transaction so any
 * failure rolls back cleanly.
 */
export function runMerge<Row extends { id: number; name?: string | null }>(
  winnerId: number,
  loserIds: number[],
  adapter: MergeAdapter<Row>,
  options?: MergeOptions,
): MergeResult<Row> {
  const uniqueLosers = Array.from(new Set(loserIds));
  if (uniqueLosers.includes(winnerId)) {
    throw new MergeError("Der Gewinner darf nicht auch Verlierer sein.");
  }
  if (uniqueLosers.length === 0) {
    throw new MergeError("Mindestens ein Verlierer ist erforderlich.");
  }
  const replaceSet = new Set(options?.replaceIds ?? []);
  for (const id of replaceSet) {
    if (!uniqueLosers.includes(id)) {
      throw new MergeError(
        `Replace-Id ${id} ist nicht in der Verlierer-Liste.`,
      );
    }
  }

  return db.transaction((tx) => {
    const winner = loadRow<Row>(tx, adapter, winnerId);
    if (!winner) {
      throw new MergeError(`Gewinner-Zeile (id=${winnerId}) nicht gefunden.`);
    }
    const losers = uniqueLosers.map((id) => {
      const row = loadRow<Row>(tx, adapter, id);
      if (!row) {
        throw new MergeError(`Verlierer-Zeile (id=${id}) nicht gefunden.`);
      }
      return row;
    });

    if (adapter.validate) {
      const error = adapter.validate([winner, ...losers]);
      if (error) throw new MergeError(error);
    }

    if (
      adapter.aliasTable &&
      adapter.aliasParentColumn &&
      adapter.aliasNameColumn
    ) {
      // Only losers in "merge" mode contribute their names+aliases. "Replace"
      // losers get their alias rows dropped but nothing is absorbed into the
      // winner — their names disappear with them.
      const mergeLosers = losers.filter((l) => !replaceSet.has(l.id));
      const replaceLosers = losers.filter((l) => replaceSet.has(l.id));
      absorbAliases(tx, adapter, winner, mergeLosers);
      if (replaceLosers.length > 0) {
        tx.delete(adapter.aliasTable)
          .where(inArray(adapter.aliasParentColumn, replaceLosers.map((l) => l.id)))
          .run();
      }
    }

    // Composite-PK dedupe FIRST (so the bulk update afterwards can't run
    // into a uniqueness conflict).
    if (adapter.customRewires) {
      adapter.customRewires(tx, winner.id, uniqueLosers);
    }

    for (const rewire of adapter.fkRewires) {
      rewireFk(tx, rewire, winner.id, uniqueLosers);
    }

    if (adapter.postProcess) {
      adapter.postProcess(tx, winner, losers);
    }

    tx.delete(adapter.table)
      .where(inArray(adapter.idColumn, uniqueLosers))
      .run();

    const winnerAfter = loadRow<Row>(tx, adapter, winnerId);
    if (!winnerAfter) {
      throw new MergeError("Gewinner-Zeile nach dem Merge nicht mehr gefunden.");
    }
    return { winner: winnerAfter, deletedIds: uniqueLosers };
  });
}

function loadRow<Row>(
  tx: Tx,
  adapter: MergeAdapter<Row>,
  id: number,
): Row | null {
  const row = tx
    .select()
    .from(adapter.table)
    .where(eq(adapter.idColumn, id))
    .get();
  return (row as Row) ?? null;
}

function absorbAliases<Row extends { id: number; name?: string | null }>(
  tx: Tx,
  adapter: MergeAdapter<Row>,
  winner: Row,
  losers: Row[],
): void {
  const aliasTable = adapter.aliasTable;
  const aliasParent = adapter.aliasParentColumn;
  const aliasName = adapter.aliasNameColumn;
  if (!aliasTable || !aliasParent || !aliasName) return;
  const aliasPlural = adapter.aliasPluralColumn ?? null;

  const existingAliases = tx
    .select({ name: aliasName })
    .from(aliasTable)
    .where(eq(aliasParent, winner.id))
    .all() as Array<{ name: string }>;
  const takenLower = new Set<string>([
    String(winner.name ?? "").toLowerCase(),
    ...existingAliases.map((r) => r.name.toLowerCase()),
  ]);

  const loserIds = losers.map((l) => l.id);
  // Each absorbed name carries its plural along when the alias table has one.
  // Loser CANONICAL names take the loser row's own plural; loser ALIAS names
  // take their alias-row plural. NULL when the entity has no plural column.
  const loserAliasRows =
    loserIds.length === 0
      ? []
      : (tx
          .select(
            aliasPlural
              ? { name: aliasName, plural: aliasPlural }
              : { name: aliasName },
          )
          .from(aliasTable)
          .where(inArray(aliasParent, loserIds))
          .all() as Array<{ name: string; plural?: string | null }>);

  const candidates: Array<{ name: string; plural: string | null }> = [];
  for (const loser of losers) {
    if (loser.name) {
      candidates.push({
        name: loser.name,
        plural: aliasPlural
          ? ((loser as { plural?: string | null }).plural ?? null)
          : null,
      });
    }
  }
  for (const row of loserAliasRows) {
    candidates.push({ name: row.name, plural: row.plural ?? null });
  }

  // Drop loser-side aliases FIRST so the inserts below don't trip the global
  // unique-name constraint on the alias table when a loser's alias name
  // becomes the winner's new alias name.
  if (loserIds.length > 0) {
    tx.delete(aliasTable).where(inArray(aliasParent, loserIds)).run();
  }

  const parentColName = bareColName(aliasParent);
  const nameColName = bareColName(aliasName);
  const pluralColName = aliasPlural ? bareColName(aliasPlural) : null;
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    if (takenLower.has(key)) continue;
    takenLower.add(key);
    if (pluralColName) {
      tx.run(
        sql`INSERT INTO ${aliasTable} (${parentColName}, ${nameColName}, ${pluralColName}) VALUES (${winner.id}, ${candidate.name}, ${candidate.plural})`,
      );
    } else {
      tx.run(
        sql`INSERT INTO ${aliasTable} (${parentColName}, ${nameColName}) VALUES (${winner.id}, ${candidate.name})`,
      );
    }
  }
}

function rewireFk(
  tx: Tx,
  rewire: FkRewire,
  winnerId: number,
  loserIds: number[],
): void {
  if (loserIds.length === 0) return;
  const setCol = bareColName(rewire.column);
  tx.run(
    sql`UPDATE ${rewire.table} SET ${setCol} = ${winnerId} WHERE ${rewire.column} IN ${sqlIdList(loserIds)}`,
  );
}

function sqlIdList(ids: number[]) {
  return sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/**
 * Returns just the column name as a quoted identifier (`"col_name"`), without
 * the table qualifier that `${column}` in a sql template would emit. Needed in
 * places where SQLite's grammar forbids qualifying — the column list inside
 * `INSERT INTO t (...)`, and the left-hand side of `UPDATE t SET ... = ...`.
 */
function bareColName(col: unknown) {
  const name = (col as { name: string }).name;
  return sql.raw(`"${name.replace(/"/g, '""')}"`);
}
