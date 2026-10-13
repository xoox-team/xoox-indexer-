import { describe, expect, it } from "vitest";
import { getAddress, keccak256, stringToHex, zeroAddress } from "viem";
import { readProFeeProgramLaunch } from "./vendor/xoox-sdk/pro-fee-program-launch";
import { proFeeProgramConfigHash } from "./vendor/xoox-sdk/pro-fee-programs";
import { replayVerifiedProProgramPlan } from "./pro-program-evidence";
import { planVerifiedProProgramCycle } from "./pro-program-execution";
import { verifiedProgramExecutionFixture } from "./test/pro-program-execution-fixture";

describe("Treasury durable evidence replay", () => {
  it("reissues a smaller two-route allocation from every saved canonical capacity quote", async () => {
    const f = await verifiedProgramExecutionFixture();
    const stable = getAddress("0x9800000000000000000000000000000000000000");
    f.codes.set(stable.toLowerCase(), "0x60006000");
    const configuration = {
      ...f.launch.configuration,
      programs: [
        {
          ...f.launch.configuration.programs[0]!,
          moduleId: 10,
          asset: stable,
          holderBps: 6000,
          recipient: f.creator,
        },
      ],
    };
    const configurationHash = proFeeProgramConfigHash(configuration);
    f.set(f.vault, "programAt", configuration.programs[0], [0n]);
    f.set(f.vault, "configurationHash", configurationHash);
    f.set(f.vault, "programBudget", 101n, [0n]);
    f.set(
      f.launch.bootstrapInfrastructure.programSource.programDeployer,
      "configurationHashOf",
      configurationHash,
      [f.vault],
    );
    const launch = await readProFeeProgramLaunch(
      f.client,
      f.launch.bootstrapInfrastructure,
      f.token,
    );
    let calls = 0;
    const plan = await planVerifiedProProgramCycle(launch, {
      ...f.input,
      configuration,
      configurationHash,
      source: { ...f.input.source, configurationHash },
      state: { ...launch.activity[0] },
      assetDecimals: [...f.input.assetDecimals, { asset: stable, decimals: 6 }],
      quote: async (request) => {
        calls++;
        const capacity = request.outputAsset === zeroAddress ? 20n : 35n;
        const amountSpent =
          request.amountIn > capacity ? capacity : request.amountIn;
        const evidenceJson = JSON.stringify({
          schema: "synthetic-canonical-treasury-capacity",
          input: request.amountIn.toString(),
          output: request.outputAsset,
          spent: amountSpent.toString(),
          blockHash: launch.blockHash,
        });
        return {
          adapter: request.program.adapter,
          adapterCodeHash: request.program.adapterCodeHash,
          inputAsset: request.inputAsset,
          outputAsset: request.outputAsset,
          amountIn: request.amountIn,
          amountSpent,
          amountOut: amountSpent * 2n,
          blockNumber: launch.blockNumber,
          blockHash: launch.blockHash,
          deadline: request.deadline,
          data: "0x0102",
          evidence: keccak256(stringToHex(evidenceJson)),
          evidenceJson,
        };
      },
    });
    expect(calls).toBe(4);
    expect(plan.cycle!.actions.map((row) => row.amount)).toEqual([30n, 20n]);
    const replay = await replayVerifiedProProgramPlan(
      launch,
      plan.evidenceJson!,
      plan.cycle!.evidence,
    );
    expect(replay.evidenceJson).toBe(plan.evidenceJson);
    expect(replay.cycle).toEqual(plan.cycle);
    expect(calls).toBe(4);
    const tampered = JSON.parse(plan.evidenceJson!);
    const quote = tampered.dependencies.find(
      (row: { amountSpent?: string }) => row.amountSpent === "35",
    );
    quote.amountSpent = "34";
    const altered = JSON.stringify(tampered);
    await expect(
      replayVerifiedProProgramPlan(
        launch,
        altered,
        plan.cycle!.evidence,
      ),
    ).rejects.toThrow();
  });
});
