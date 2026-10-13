import { describe, expect, it } from "vitest";
import {
  encodeFunctionData,
  keccak256,
  zeroAddress,
  zeroHash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifiedProgramExecutionFixture } from "./test/pro-program-execution-fixture";
import { finalizeVerifiedProProgramReward } from "./pro-program-execution";
import { verifyProFeeProgramHolderRootReceipt } from "./vendor/xoox-sdk/pro-fee-program-receipts";
import {
  proFeeProgramLaunchAbi,
  readProFeeProgramLaunch,
} from "./vendor/xoox-sdk/pro-fee-program-launch";
import { readProBootstrapInfrastructure } from "./vendor/xoox-sdk/pro-bootstrap";
import {
  readProProgramHistory,
  type ProProgramHistoryJob,
  type ProProgramHistoryClaim,
} from "./pro-program-history";

const authority = privateKeyToAccount(`0x${"11".repeat(32)}`);
/** Service storage rows are normalized from reader-issued execution/publication proof
 * data. The SDK performs genuine issuance against canonical synthetic wire data;
 * these runtime fixtures are never deployment approvals. */
async function fixture() {
  const f = await verifiedProgramExecutionFixture({
    creator: authority.address,
  });
  const checkpoint = await readProFeeProgramLaunch(
    f.client,
    await readProBootstrapInfrastructure(
      f.client,
      f.launch.factory,
      f.manifest,
      {
        chainId: 143n,
        blockNumber: 125n,
        blockHash: f.header3.hash,
        blockTimestamp: f.header3.timestamp,
      },
    ),
    f.token,
  );
  const publication = finalizeVerifiedProProgramReward(
    f.plan,
    0,
    f.receipt,
    checkpoint,
  );
  const expected = {
    programIndex: 0,
    cycleId: 1n,
    sender: authority.address,
    root: publication.root,
    observedAt: publication.observedAt,
    deadline: publication.deadline,
    evidence: publication.evidence,
  };
  const receipt = f.makeTransaction(
    f.publicationHash,
    125n,
    encodeFunctionData({
      abi: proFeeProgramLaunchAbi,
      functionName: "publishHolderRoot",
      args: [
        0n,
        1n,
        publication.root,
        publication.observedAt,
        publication.deadline,
        publication.evidence,
      ],
    }),
  );
  receipt.logs.push(
    f.event(
      f.publicationHash,
      125n,
      "RewardRootPublished",
      {
        program: 0n,
        cycle: 1n,
        asset: zeroAddress,
        root: publication.root,
        reserved: 83n,
        observedAt: 1000n,
      },
      0,
    ),
    f.event(
      f.publicationHash,
      125n,
      "HolderRootEvidence",
      { program: 0n, cycle: 1n, evidence: publication.evidence },
      1,
    ),
  );
  f.setAt(
    f.header3.hash,
    f.vault,
    "rewardRoots",
    [publication.root, zeroAddress, 83n, 0n, 1000n],
    [0n, 1n],
  );
  f.setAt(
    f.header3.hash,
    f.vault,
    "holderPublicationEvidence",
    publication.evidence,
    [0n, 1n],
  );
  f.setAt(f.header3.hash, f.vault, "holderClaimed", false, [0n, 1n, f.holder]);
  f.setAt(f.header3.hash, f.vault, "holderCreditSequence", 0n, [
    0n,
    1n,
    f.holder,
  ]);
  f.setAt(
    f.header3.hash,
    f.vault,
    "holderCreditState",
    [0n, 0n, 0n],
    [zeroAddress, f.holder],
  );
  const proof = await verifyProFeeProgramHolderRootReceipt(
      f.client,
      checkpoint,
      f.publicationHash,
      expected,
    ),
    launch = proof.launch;
  const job: ProProgramHistoryJob = {
    id: keccak256("0x2211"),
    chainId: 143,
    token: launch.token,
    factory: launch.factory,
    vault: launch.vault,
    configurationHash: launch.configurationHash,
    programIndex: 0,
    cycleId: 1n,
    evidence: publication.evidence,
    phase: "holder-root",
    status: "accepted",
    transactionHash: proof.transactionHash,
    acceptance: {
      transactionHash: proof.transactionHash,
      blockNumber: proof.blockNumber,
      blockHash: proof.blockHash,
      blockTimestamp: proof.blockTimestamp,
      root: proof.root,
      asset: proof.asset,
      reserved: proof.reserved,
      claimed: proof.claimed,
      observedAt: proof.observedAt,
    },
  };
  const row = publication.allocation.allocations[0]!;
  const entitlement: ProProgramHistoryClaim = {
    jobId: job.id,
    programIndex: 0,
    cycleId: 1n,
    wallet: row.account as Address,
    amount: row.amount,
    proof: row.proof,
    asset: publication.allocation.asset,
    root: publication.root,
    reserved: publication.allocation.total,
    observedAt: publication.observedAt,
  };
  const input = {
    client: f.client,
    launch,
    wallet: f.holder,
    jobs: [job],
    entitlements: [entitlement],
    finalizedBlockNumber: 125n,
    truncated: false,
  };
  return { ...f, publication, proof, job, entitlement, input };
}

describe("canonical normalized Revenue Program history", () => {
  it("returns only the genuine funded unpaid wallet leaf without private service data", async () => {
    const f = await fixture(),
      result = await readProProgramHistory(f.input);
    expect(result.incomplete).toBe(false);
    expect(result.claims).toEqual([
      {
        programIndex: 0,
        cycleId: "1",
        wallet: f.holder,
        amount: "83",
        proof: [],
        asset: zeroAddress,
        root: f.publication.root,
        reserved: "83",
        observedAt: "1000",
        receiptBlockHash: f.header3.hash,
        consumed: false,
        canClaim: true,
        paymentStatus: "unconsumed",
        creditSequence: "0",
        payoutAfterClaim: false,
        credit: {
          balance: "0",
          creditedThrough: "0",
          paidThrough: "0",
          minimumClaim: "1000000000000000",
          decimals: 18,
          canPayout: false,
        },
      },
    ]);
    expect(result.history).toMatchObject([
      {
        transactionHash: f.publicationHash,
        eventName: "RewardRootPublished",
        amount: "83",
      },
    ]);
    const data = JSON.stringify(result);
    expect(data).not.toContain("signed");
    expect(data).not.toContain("balancesComplete");
    expect(data).not.toContain("population");
    expect(data).not.toContain("evidenceJson");
  });
  it.each(["credited", "paid"] as const)(
    "retains consumed %s rights with canonical payment sequences on older history pages",
    async (status) => {
      const f = await fixture();
      f.setAt(
        f.header3.hash,
        f.vault,
        "rewardRoots",
        [f.publication.root, zeroAddress, 83n, 83n, 1000n],
        [0n, 1n],
      );
      f.setAt(f.header3.hash, f.vault, "holderClaimed", true, [
        0n,
        1n,
        f.holder,
      ]);
      f.setAt(f.header3.hash, f.vault, "holderCreditSequence", 1n, [
        0n,
        1n,
        f.holder,
      ]);
      f.setAt(
        f.header3.hash,
        f.vault,
        "holderCreditState",
        status === "paid" ? [0n, 1n, 1n] : [83n, 1n, 0n],
        [zeroAddress, f.holder],
      );
      const result = await readProProgramHistory({
        ...f.input,
        truncated: true,
        nextCursor: "12",
      });
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0]).toMatchObject({
        wallet: f.holder,
        amount: "83",
        consumed: true,
        canClaim: false,
        paymentStatus: status,
        creditSequence: "1",
        payoutAfterClaim: false,
        credit: {
          balance: status === "paid" ? "0" : "83",
          creditedThrough: "1",
          paidThrough: status === "paid" ? "1" : "0",
          minimumClaim: "1000000000000000",
          decimals: 18,
          canPayout: false,
        },
      });
      expect(result.history).toHaveLength(1);
      expect(result.incomplete).toBe(true);
      expect(result.nextCursor).toBe("12");
    },
  );
  it("keeps an older paid leaf paid when newer wallet credits remain pending", async () => {
    const f = await fixture();
    f.setAt(
      f.header3.hash,
      f.vault,
      "rewardRoots",
      [f.publication.root, zeroAddress, 83n, 83n, 1000n],
      [0n, 1n],
    );
    f.setAt(f.header3.hash, f.vault, "holderClaimed", true, [0n, 1n, f.holder]);
    f.setAt(f.header3.hash, f.vault, "holderCreditSequence", 1n, [
      0n,
      1n,
      f.holder,
    ]);
    f.setAt(
      f.header3.hash,
      f.vault,
      "holderCreditState",
      [17n, 2n, 1n],
      [zeroAddress, f.holder],
    );
    const result = await readProProgramHistory(f.input);
    expect(result.claims[0]).toMatchObject({
      paymentStatus: "paid",
      consumed: true,
      creditSequence: "1",
      credit: { balance: "17", creditedThrough: "2", paidThrough: "1" },
    });
    expect(JSON.stringify(result)).not.toContain("bootstrapInfrastructure");
  });
  it.each([
    "launch-copy",
    "factory",
    "vault",
    "token",
    "config",
    "chain",
    "evidence",
  ] as const)("rejects invalid %s provenance", async (kind) => {
    const f = await fixture(),
      job = { ...f.job };
    if (kind === "factory") job.factory = f.curve;
    if (kind === "vault") job.vault = f.curve;
    if (kind === "token") job.token = f.curve;
    if (kind === "config") job.configurationHash = keccak256("0x9999");
    if (kind === "chain") job.chainId = 31337;
    if (kind === "evidence") job.evidence = zeroHash;
    await expect(
      readProProgramHistory({
        ...f.input,
        launch: kind === "launch-copy" ? { ...f.input.launch } : f.input.launch,
        jobs: [job],
      }),
    ).rejects.toThrow();
  });
  it.each([
    "unknown-job",
    "wrong-wallet",
    "wrong-cycle",
    "wrong-root",
    "wrong-funding",
    "duplicate",
  ] as const)(
    "rejects %s entitlement rather than exposing claim calldata",
    async (kind) => {
      const f = await fixture(),
        row = { ...f.entitlement };
      if (kind === "unknown-job") row.jobId = keccak256("0x8888");
      if (kind === "wrong-wallet") row.wallet = authority.address;
      if (kind === "wrong-cycle") row.cycleId = 2n;
      if (kind === "wrong-root") row.root = keccak256("0x3344");
      if (kind === "wrong-funding") row.reserved = 84n;
      await expect(
        readProProgramHistory({
          ...f.input,
          entitlements: kind === "duplicate" ? [row, row] : [row],
        }),
      ).rejects.toThrow();
    },
  );
  it.each(["wrong-amount", "wrong-proof"] as const)(
    "does not expose a counterfeit %s leaf",
    async (kind) => {
      const f = await fixture(),
        row = { ...f.entitlement };
      if (kind === "wrong-amount") row.amount = 82n;
      else row.proof = [keccak256("0x3344")];
      const result = await readProProgramHistory({
        ...f.input,
        entitlements: [row],
      });
      expect(result.claims).toHaveLength(0);
    },
  );
  it("marks stored receipt reorgs incomplete and withholds stale claims at a newly issued canonical source", async () => {
    const f = await fixture(),
      newHash = keccak256("0xdeadbeef");
    f.headers.set(125n, { hash: newHash, timestamp: f.header3.timestamp });
    f.overrides.set(newHash, new Map(f.overrides.get(f.header3.hash)!));
    const launch = await readProFeeProgramLaunch(
      f.client,
      await readProBootstrapInfrastructure(
        f.client,
        f.launch.factory,
        f.manifest,
        {
          chainId: 143n,
          blockNumber: 125n,
          blockHash: newHash,
          blockTimestamp: f.header3.timestamp,
        },
      ),
      f.token,
    );
    const result = await readProProgramHistory({ ...f.input, launch });
    expect(result.incomplete).toBe(true);
    expect(result.claims).toHaveLength(0);
    expect(result.history).toHaveLength(0);
  });
  it("rejects a reorganized current issued source and insufficient finality", async () => {
    const f = await fixture();
    await expect(
      readProProgramHistory({ ...f.input, finalizedBlockNumber: 124n }),
    ).rejects.toThrow(/finalized/);
    f.headers.set(125n, {
      hash: keccak256("0x7777"),
      timestamp: f.header3.timestamp,
    });
    await expect(readProProgramHistory(f.input)).rejects.toThrow(/reorganized/);
  });
  it("labels truncated history and uncertain jobs without promoting them into claims", async () => {
    const f = await fixture(),
      pending = { ...f.job, status: "uncertain" as const, acceptance: null };
    const result = await readProProgramHistory({
      ...f.input,
      jobs: [pending],
      entitlements: [],
      truncated: true,
    });
    expect(result.incomplete).toBe(true);
    expect(result.claims).toHaveLength(0);
    expect(result.history).toHaveLength(0);
    expect(result.pending).toMatchObject([
      { status: "uncertain", phase: "holder-root", cycleId: "1" },
    ]);
    await expect(
      readProProgramHistory({ ...f.input, jobs: [pending] }),
    ).rejects.toThrow(/accepted job/);
  });
});
