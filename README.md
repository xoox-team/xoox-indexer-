# xoox-indexer

The single [Envio HyperIndex](https://docs.envio.dev) indexer for the XOOX protocol on **Monad testnet (chain 10143)**.
It replaces four separate indexers (launch/trade core, Pro, TradeDex, terminal TradeFeed) with one process and one
PostgreSQL schema served through Hasura. This repository is the code that runs: the indexer, the few protocol helpers it uses (vendored), the
generated frozen configuration, the launch guard that starts it, and read-only operations tooling.

## What it covers

22 contracts, 69 events, 55 entities (`config-lint` asserts these counts against the frozen config and `schema.graphql`).

| Family | Contracts | What it records |
| --- | --- | --- |
| Launch and trade core | `Factory`, `LaunchRouter`, `Curve`, `Token`, `FeeVault`, `DividendVault`, `OgDividendVault`, `Hook`, `SwapRouter`, `PaymentRouter`, `PoolManager`, `Treasury` | Launches, curve buys and sells, Uniswap V4 pool swaps, fee accrual, dividend and OG reward vaults, Duo launches, launch staking |
| Pro | `ProFactory`, `ProSwapRouter`, `ProCurve`, `ProToken`, `ProPolicy`, `ProConsentRegistry`, `ProGraduationRegistry` | Pro tokens, rules, consent, holder ledgers, graduation, pool-router trades |
| TradeDex | `TradeV3Factory`, `TradeV4PoolManager` | Pool discovery for the trade aggregator and its coverage state |
| Terminal feed | `TerminalRouter` | One `TradeFeed` row per router `Trade` event |

The chain starts at block 61,283,810 (the `TradeV4PoolManager` start; it may never move, because the web's
`TradeDexCoverage` id hashes the start blocks), with `max_reorg_depth` 128 and `block_lag` 2.

## Layout

| Path | Role |
| --- | --- |
| `schema.graphql`, `config.xoox-one.json`, `config.xoox-one.breakglass.json` | Entity schema and the frozen configs (standard and break-glass); `config.codegen.yaml` / `config.test.yaml` for typing and tests |
| `src` | Handlers (`src/handlers`, `src/pro-*`, `src/trade-dex-*`, `src/terminal-feed`) and the config source (`src/configuration.ts`) |
| `src/vendor/xoox-sdk` | Only the protocol helpers the handlers use (ABIs, manifest parsing, protocol math, Pro helpers) |
| `scripts` | Config generator and lint, launch guard and launcher, read-only operations tooling (below) |
| `deployments/10143.json` | Public deployment manifest, the generator's input |
| `output/four-step-integration-2026-10-06/step4-reviewed-inputs.public.json` | Digest-checked list of the reviewed Pro factories (public addresses), the generator's second input |
| `test-fixtures` | Small test inputs; see `test-fixtures/README.md` |
| `Dockerfile`, `.dockerignore` | The indexer image |

## How it uses Envio HyperIndex

- **HyperSync for history.** Past blocks come from HyperSync (`ENVIO_API_TOKEN`). The free tier is too slow to backfill
  the whole chain; see the backfill lesson below.
- **RPC pollers for the head.** The frozen config carries three keyless RPC entries. `rpc[1]` and `rpc[2]` are two
  public pollers, `for: realtime`, polling every 2 s in 1000-block steps: once HyperSync has caught up, Envio switches
  to them for lower latency. `rpc[0]` is the public Monad RPC, `for: fallback`: the standby that takes over when real-time
  indexing stalls and the **archive endpoint** every effect reads.
- **Effects read the archive RPC.** Royalty recipients, the Pro pool-router binding, the reviewed Pro consent source,
  the reviewed Pro holder genesis and TradeDex evidence and token metadata are Envio effects that make `eth_call`
  reads at historical blocks. They take the URL from `INDEXER_CONTRACT_RPC_URL`, which must equal `rpc[0].url`; only the
  public Monad node serves archive `eth_call` for this chain. Effect loaders `JSON.parse` the raw `ENVIO_CONFIG` file,
  so the frozen configs are pure JSON with no comments and no `${ENV}` placeholders.
- **Effect-cache seeding.** On a clean initialize Envio restores `.envio/cache/<chainId>/<effect>.tsv` into the effect
  cache tables with `psql` (the image installs `postgresql-client`), so a replay does not call the archive RPC again for
  the five seeded effects. `scripts/effect-cache-export.ts` produces those files from an existing database.
  The minute-bucketed TradeDex token-metadata effect is deliberately not seeded.
- **Break-glass, RPC-only.** `config.xoox-one.breakglass.json` is the same configuration with the two pollers switched to
  `for: sync`: Envio then reads history from them instead of HyperSync, with no API token and no reindex.
- **Huginn-first backfill lesson.** HyperSync's free-tier rate limit (about 15 queries a minute, divided further by
  Envio's global backoff across partitions) makes a full backfill impractical. Backfill on the break-glass config with
  the two poller entries swapped so that the Huginn poller comes first (the committed file lists POSTHUMAN first; the
  lint accepts either order): block 61.28M to the head took about 35 minutes. The POSTHUMAN poller returns null for
  blocks below roughly 69.09M, and as the first sync source it crash-loops Envio on a lazy-loader timeout. Archive
  `eth_call` works only on the public node; when both sync sources fail Envio falls back to it and meets its per-IP
  rate cap, so keep both pollers healthy.
- **Generated, then frozen.** `config.xoox-one*.json` are produced by `pnpm config:generate` from the manifest, the
  reviewed Pro inputs and the TerminalRouter identity, and `pnpm config:check` fails if either file on disk differs
  from a regeneration. `block_lag` is persisted by Envio and decided once; a re-run keeps the value already in the file.

## Run it

Requirements: Node 24 (`.nvmrc`, `engines` in `package.json`) and pnpm 10.17.0.

```sh
pnpm install --frozen-lockfile
pnpm codegen           # envio codegen for config.codegen.yaml
pnpm typecheck         # indexer against config.xoox-one.json and config.test.yaml, scripts
pnpm test              # vitest: indexer and scripts
pnpm config:check      # frozen configs match a regeneration
pnpm config:lint       # counts, chain fields, rpc block, effect-loader gates
```

To run the indexer you need PostgreSQL and a Hasura on the same database. The repository ships no compose file for
them. Copy `.env.example` to a private, owner-only file and fill in the values (never commit it), then either:

```sh
docker build -t xoox-one:local .
docker run --env-file <your private env file> xoox-one:local
```

or, from a checkout with those variables exported, `pnpm start`. Both go through `scripts/launch.sh`. The image
runs as `node`, sets no entrypoint and starts only that launcher. `.env.example` lists variable names with placeholder
values; the real values are the operator's.

## The launch guard

Envio calls `clear_metadata` on its Hasura endpoint when it initializes a fresh database, and a default Hasura endpoint
can be a live one. The guard (`scripts/launch-guard-lib.ts`) therefore refuses to start unless all of these hold:

- `ENVIO_PG_DATABASE` matches `xoox_one_*` and `ENVIO_PG_SCHEMA` is `xoox`, so no retained database can be reset;
- `HASURA_GRAPHQL_ENDPOINT` is `http(s)://<host>[:port]/v1/metadata` without credentials, where `<host>` is exactly the
  Hasura service name fixed in `launch-guard-lib.ts` (`XOOX_ONE_HASURA_HOST`), and `HASURA_GRAPHQL_ADMIN_SECRET` is set;
- `ENVIO_CONFIG` is an absolute path and `INDEXER_CONTRACT_RPC_URL` is set;
- that Hasura sits on `ENVIO_PG_DATABASE` and, until Envio has initialized it, tracks no tables;
- every other (old, live) Hasura passed in `XOOX_ONE_LIVE_HASURA_ENDPOINTS` or `--live-hasura` rejects the new admin
  secret (HTTP 401 on the metadata API, or Hasura's `access-denied` GraphQL reply with HTTP 200 on `/v1/graphql`);
- the frozen config passes `config-lint`.

No request is sent, and the secret goes nowhere, until the static environment checks pass; failures print reasons, never
values. `launch.sh` takes no arguments, refuses to start if any `.env` file sits in the indexer directory, sets
`DOTENV_CONFIG_PATH=/dev/null`, runs the guard, then `exec`s a bare `envio start` in the same process tree, with no
config override and no restart flag.

## Operations tooling

All of it only reads (HTTP GETs, read-only queries, `SELECT` and `COPY ... TO STDOUT`), takes connection details from
the environment, and never prints a secret.

| Command | Purpose |
| --- | --- |
| `pnpm config:generate` / `config:check` / `config:lint` | Write, verify and lint the frozen configs |
| `tsx scripts/parity-sql.ts` | Short per-table SQL (row count and digest, then 256 buckets, then row hashes) to diff a family's old database against the new one |
| `tsx scripts/type-parity.ts` | Compare Hasura column types and JSON value kinds between an old and the new endpoint (`PARITY_SOURCE_*`, `PARITY_TARGET_*`) |
| `tsx scripts/effect-cache-export.ts` | Dump the effect-cache tables of an existing database to `.envio/cache` (libpq `PG*` variables; prints only the plan without `--run`). The per-source default database names (`xoox_pro_source`, `xoox_trade_source`) are placeholders: pass the real one with `--database NAME` |
| `tsx scripts/backfill-estimator.ts` | Estimate a HyperSync backfill from the cost headers of sampled queries (`ENVIO_HYPERSYNC_URL`, `ENVIO_API_TOKEN`) |

The parity tools compare against `test-fixtures/terminal-feed/schema.graphql`, the schema of the retired terminal-feed
indexer.

## Not in this repository

The web application, the Solidity contracts and the four retired indexers' configurations and launchers. Tests that
used them as oracles run against the vendored copies in `test-fixtures`, with their provenance recorded there.
Operational notes worth keeping: Hasura serves `chain_metadata.latest_processed_block` as a JSON number, and the
handlers never set `TradeDexCoverage.historyComplete`; promote it with the indexer stopped, after parity against an
attested dataset.
