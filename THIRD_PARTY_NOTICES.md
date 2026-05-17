# Third Party Notices

## Tandoor Recipes — open-tandoor-data

A snapshot of [`TandoorRecipes/open-tandoor-data`](https://github.com/TandoorRecipes/open-tandoor-data)
`build/de.json` is vendored at `data/seed/tandoor-de.json`. It is the source for
the "Standarddaten laden" action in Einstellungen.

- **Schema:** licensed under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- **Contents (the records):** licensed under the [Database Contents License (DbCL) v1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
- **Attribution:** © Tandoor Recipes contributors.

### Update procedure

1. Download a fresh `build/de.json` from the upstream repository.
2. Replace `data/seed/tandoor-de.json` and commit.
3. Re-deploy.
4. In Einstellungen → Standarddaten, click "Standarddaten laden". The transform
   is idempotent: existing entries are skipped, new aliases on known entries
   are added, and new entries are inserted.
