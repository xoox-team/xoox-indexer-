import {
  createEffect,
  indexer,
  S,
  type EvmOnEventContext,
  type ProLaunch,
} from "envio";
import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
} from "viem";
import { proHolderContractConfigured } from "./pro-consent-source";
import { loadProHolderSource } from "./pro-holder-source";

type Identity = {
  chainId: number;
  srcAddress: string;
  block: { number: number; timestamp: number; hash: string };
  transaction: { hash: string };
  logIndex: number;
};
const lower = (value: string) => value.toLowerCase();
const launchId = (chain: number, token: string) => `${chain}:${lower(token)}`;
export const proHolderId = (chain: number, token: string, account: string) =>
  `${launchId(chain, token)}:${lower(account)}`;
const eventId = (chain: number, tx: string, index: number) =>
  `${chain}:${lower(tx)}:${index}`;
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Pro holders: ${message}`);
}
function stamp(event: Identity) {
  ensure(
    Number.isSafeInteger(event.chainId) &&
      event.chainId > 0 &&
      Number.isSafeInteger(event.block.number) &&
      event.block.number >= 0 &&
      Number.isSafeInteger(event.block.timestamp) &&
      event.block.timestamp >= 0 &&
      Number.isSafeInteger(event.logIndex) &&
      event.logIndex >= 0 &&
      /^0x[\da-fA-F]{64}$/.test(event.block.hash) &&
      /^0x[\da-fA-F]{64}$/.test(event.transaction.hash),
    "event provenance unavailable.",
  );
  return {
    blockNumber: BigInt(event.block.number),
    blockHash: lower(event.block.hash),
    timestamp: BigInt(event.block.timestamp),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  };
}
const effect = createEffect(
  {
    name: "canonicalReviewedProHolderGenesisV4",
    input: {
      factory: S.string,
      token: S.string,
      curve: S.string,
      policy: S.string,
      creator: S.string,
      configurationHash: S.string,
      supply: S.bigint,
      blockNumber: S.bigint,
      blockHash: S.string,
      timestamp: S.bigint,
      transactionHash: S.string,
      launchLogIndex: S.int32,
    },
    output: S.schema({
      tokenCodeHash: S.string,
      sourceVersion: S.int32,
      reviewId: S.string,
      tokenDecimals: S.int32,
      mintLogIndex: S.int32,
      programVault: S.string,
      infrastructure: S.array(S.string),
      cumulativeBurned: S.bigint,
    }),
    rateLimit: { calls: 5, per: "second" },
    cache: true,
    crossChain: false,
  },
  async ({ input, context }) => {
    const source = await loadProHolderSource(context.chain.id, input);
    return { ...source, infrastructure: [...source.infrastructure] };
  },
);
function payload(token: string, from: string, to: string, value: bigint) {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address,address,address,uint256"), [
      token as Address,
      from as Address,
      to as Address,
      value,
    ]),
  );
}

/** Lazy receipt verification avoids relying on the discovery engine's ordering
 * of constructor Transfer versus the later Factory LaunchCreated event.
 */
export async function activateProHolderLedger(
  context: EvmOnEventContext,
  launch: ProLaunch,
) {
  const previous = await context.ProHolderLedger.get(launch.id);
  if (previous) return previous;
  const source = await context.effect(effect, {
    factory: launch.factory,
    token: launch.token,
    curve: launch.curve,
    policy: launch.policy,
    creator: launch.creator,
    configurationHash: launch.configurationHash,
    supply: launch.supply,
    blockNumber: launch.createdBlock,
    blockHash: launch.createdBlockHash,
    timestamp: launch.createdAt,
    transactionHash: launch.creationTransactionHash,
    launchLogIndex: launch.creationLogIndex,
  });
  ensure(
    source.tokenDecimals === 18 &&
      [1, 2, 3, 4].includes(source.sourceVersion) &&
      source.mintLogIndex < launch.creationLogIndex &&
      source.mintLogIndex >= 0 &&
      /^0x[\da-fA-F]{64}$/.test(source.tokenCodeHash),
    "authenticated genesis source differs.",
  );
  const pending = await context.ProPendingMint.get(launch.id);
  if (pending)
    ensure(
      pending.token === launch.token &&
        pending.recipient === launch.curve &&
        pending.amount === launch.supply &&
        pending.blockNumber === launch.createdBlock &&
        pending.blockHash === launch.createdBlockHash &&
        pending.transactionHash === launch.creationTransactionHash &&
        pending.logIndex === source.mintLogIndex,
      "constructor mint differs from accepted launch receipt.",
    );
  const id = eventId(
    launch.chainId,
    launch.creationTransactionHash,
    source.mintLogIndex,
  );
  context.ProHolder.set({
    id: proHolderId(launch.chainId, launch.token, launch.curve),
    launchId: launch.id,
    chainId: launch.chainId,
    token: launch.token,
    account: launch.curve,
    balance: launch.supply,
    updatedAt: launch.createdAt,
    updatedBlock: launch.createdBlock,
    updatedBlockHash: launch.createdBlockHash,
  });
  context.ProTokenTransfer.set({
    id,
    launchId: launch.id,
    chainId: launch.chainId,
    token: launch.token,
    from: zeroAddress,
    to: launch.curve,
    amount: launch.supply,
    blockNumber: launch.createdBlock,
    blockHash: launch.createdBlockHash,
    timestamp: launch.createdAt,
    transactionHash: launch.creationTransactionHash,
    logIndex: source.mintLogIndex,
  });
  context.ProHolderProcessedEvent.set({
    id,
    blockHash: launch.createdBlockHash,
    payloadHash: payload(
      launch.token,
      zeroAddress,
      launch.curve,
      launch.supply,
    ),
  });
  const ledger = {
    id: launch.id,
    chainId: launch.chainId,
    token: launch.token,
    factory: launch.factory,
    creator: launch.creator,
    curve: launch.curve,
    policy: launch.policy,
    configurationHash: launch.configurationHash,
    tokenCodeHash: lower(source.tokenCodeHash),
    sourceVersion: source.sourceVersion,
    reviewId: source.reviewId,
    tokenDecimals: source.tokenDecimals,
    programVault: source.programVault || undefined,
    infrastructure: source.infrastructure.map(lower),
    genesisSupply: launch.supply,
    currentSupply: launch.supply,
    cumulativeBurned: 0n,
    holderCount: 1n,
    createdBlock: launch.createdBlock,
    createdBlockHash: launch.createdBlockHash,
    creationTransactionHash: launch.creationTransactionHash,
    mintLogIndex: source.mintLogIndex,
    lastBlock: launch.createdBlock,
    lastBlockHash: launch.createdBlockHash,
    lastLogIndex: source.mintLogIndex,
  };
  context.ProHolderLedger.set(ledger);
  if (pending) context.ProPendingMint.deleteUnsafe(launch.id);
  return ledger;
}

if (proHolderContractConfigured())
  indexer.onEvent(
    { contract: "ProToken", event: "Transfer" },
    async ({ event, context }) => {
      const provenance = stamp(event),
        token = lower(event.srcAddress),
        from = lower(event.params.from),
        to = lower(event.params.to),
        amount = event.params.value;
      ensure(
        [token, from, to].every((item) => isAddress(item, { strict: true })) &&
          token !== zeroAddress &&
          amount >= 0n,
        "invalid transfer units/identity.",
      );
      const id = eventId(event.chainId, event.transaction.hash, event.logIndex),
        fingerprint = payload(token, from, to, amount);
      const priorEvent = await context.ProHolderProcessedEvent.get(id);
      if (priorEvent) {
        ensure(
          priorEvent.blockHash === provenance.blockHash &&
            priorEvent.payloadHash === fingerprint,
          "duplicate event changed; canonical rollback is required.",
        );
        return;
      }
      const key = launchId(event.chainId, token),
        launch = await context.ProLaunch.get(key);
      if (!launch) {
        ensure(
          from === zeroAddress && to !== zeroAddress && amount > 0n,
          "unaccepted token source has no constructor mint.",
        );
        const previous = await context.ProPendingMint.get(key);
        ensure(
          !previous ||
            (previous.blockHash === provenance.blockHash &&
              previous.transactionHash === provenance.transactionHash &&
              previous.logIndex === event.logIndex &&
              previous.amount === amount &&
              previous.recipient === to),
          "unaccepted token has conflicting genesis events.",
        );
        context.ProPendingMint.set({
          id: key,
          token,
          recipient: to,
          amount,
          ...provenance,
        });
        return;
      }
      ensure(
        launch.chainId === event.chainId && launch.token === token,
        "token differs from accepted Factory launch.",
      );
      const ledger = await activateProHolderLedger(context, launch);
      // Activation has already recorded the authentic constructor issuance.
      if (from === zeroAddress) {
        ensure(
          provenance.blockHash === ledger.createdBlockHash &&
            provenance.transactionHash === ledger.creationTransactionHash &&
            event.logIndex === ledger.mintLogIndex &&
            to === ledger.curve &&
            amount === ledger.genesisSupply,
          "additional mint is forbidden.",
        );
        return;
      }
      ensure(
        provenance.blockNumber >= ledger.lastBlock &&
          (provenance.blockNumber !== ledger.lastBlock ||
            (provenance.blockHash === ledger.lastBlockHash &&
              event.logIndex > ledger.lastLogIndex)),
        "history is out of order or requires canonical rollback.",
      );
      ensure(
        provenance.transactionHash !== ledger.creationTransactionHash ||
          event.logIndex > launch.creationLogIndex,
        "non-mint transfer precedes genuine launch acceptance.",
      );
      ensure(
        to !== zeroAddress ||
          (ledger.sourceVersion === 4 &&
            from === ledger.programVault &&
            amount > 0n),
        "burn differs from genuine program Vault.",
      );
      let holderCount = ledger.holderCount;
      const sender = await context.ProHolder.get(
        proHolderId(event.chainId, token, from),
      );
      ensure(
        (sender?.balance ?? 0n) >= amount,
        "transfer replay is missing earlier balance history.",
      );
      if (from !== to)
        for (const [account, delta] of [
          [from, -amount],
          [to, amount],
        ] as const) {
          if (account === zeroAddress) continue;
          const holderKey = proHolderId(event.chainId, token, account),
            previous = await context.ProHolder.get(holderKey),
            before = previous?.balance ?? 0n,
            balance = before + delta;
          ensure(balance >= 0n, "holder balance is negative.");
          context.ProHolder.set({
            id: holderKey,
            launchId: key,
            chainId: event.chainId,
            token,
            account,
            balance,
            updatedAt: provenance.timestamp,
            updatedBlock: provenance.blockNumber,
            updatedBlockHash: provenance.blockHash,
          });
          if (before === 0n && balance > 0n) holderCount++;
          if (before > 0n && balance === 0n) holderCount--;
        }
      const currentSupply =
          ledger.currentSupply - (to === zeroAddress ? amount : 0n),
        cumulativeBurned =
          ledger.cumulativeBurned + (to === zeroAddress ? amount : 0n);
      ensure(
        currentSupply >= 0n &&
          currentSupply + cumulativeBurned === ledger.genesisSupply,
        "supply conservation differs.",
      );
      context.ProHolderLedger.set({
        ...ledger,
        currentSupply,
        cumulativeBurned,
        holderCount,
        lastBlock: provenance.blockNumber,
        lastBlockHash: provenance.blockHash,
        lastLogIndex: event.logIndex,
      });
      context.ProTokenTransfer.set({
        id,
        launchId: key,
        chainId: event.chainId,
        token,
        from,
        to,
        amount,
        ...provenance,
      });
      context.ProHolderProcessedEvent.set({
        id,
        blockHash: provenance.blockHash,
        payloadHash: fingerprint,
      });
    },
  );
