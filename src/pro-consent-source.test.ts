import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress, zeroAddress } from "viem";
import {
  loadProConsentSource,
  parseProConsentIndexerSources,
  proConsentContractConfigured,
  proStandardIndexerContractsConfigured,
  readProConsentSource,
} from "./pro-consent-source";
import { envioConfiguration } from "./configuration";
import { consentHash, consentIndexerFixture } from "./test/pro-consent-fixture";

describe("explicit reviewed consent source configuration", () => {
  it("normalizes the seven-key genuine v3 manifest with the exact RegistryV2 artifact", () => {
    const f = consentIndexerFixture();
    const [source] = parseProConsentIndexerSources(f.raw());
    expect(source!.chainId).toBe(143n);
    expect(source!.bootstrapManifest.version).toBe(3);
    expect(
      source!.bootstrapManifest.artifacts.linkRegistry!.artifact,
    ).toContain("ProLinkRegistryV2.sol:ProLinkRegistryV2");
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source!.bootstrapManifest.artifacts)).toBe(true);
  });
  it.each([1, 2] as const)(
    "rejects a genuinely reviewed legacy v%s manifest",
    (version) => {
      const f = consentIndexerFixture(version);
      expect(() => parseProConsentIndexerSources(f.raw())).toThrow(
        "Bootstrap v3",
      );
    },
  );
  it.each([
    [
      "unknown root",
      (v: any) => {
        v.extra = true;
      },
    ],
    [
      "missing root",
      (v: any) => {
        delete v.version;
      },
    ],
    [
      "unknown source",
      (v: any) => {
        v.sources[0].runtime = "0x6000";
      },
    ],
    [
      "numeric chain",
      (v: any) => {
        v.sources[0].chainId = 143;
      },
    ],
    [
      "unsafe chain",
      (v: any) => {
        v.sources[0].chainId = "9007199254740992";
      },
    ],
    [
      "zero chain",
      (v: any) => {
        v.sources[0].chainId = "0";
      },
    ],
    [
      "noncanonical chain",
      (v: any) => {
        v.sources[0].chainId = "0143";
      },
    ],
    [
      "wrong manifest chain",
      (v: any) => {
        v.sources[0].bootstrapManifest.chainId = "31337";
      },
    ],
    [
      "wrong helper",
      (v: any) => {
        v.sources[0].helper = v.sources[0].factory;
      },
    ],
    [
      "zero Registry",
      (v: any) => {
        v.sources[0].registry = zeroAddress;
      },
    ],
    [
      "disabled Reactive",
      (v: any) => {
        v.sources[0].bootstrapManifest.configuration.reactive = false;
      },
    ],
    [
      "profile boolean",
      (v: any) => {
        v.sources[0].bootstrapManifest.profile = true;
      },
    ],
    [
      "unknown artifact",
      (v: any) => {
        v.sources[0].bootstrapManifest.artifacts.extra =
          v.sources[0].bootstrapManifest.artifacts.factory;
      },
    ],
    [
      "missing child",
      (v: any) => {
        delete v.sources[0].bootstrapManifest.artifacts.reactiveValidationChild;
      },
    ],
    [
      "wrong Registry artifact",
      (v: any) => {
        v.sources[0].bootstrapManifest.artifacts.linkRegistry.artifact =
          "packages/contracts/src/pro/ProLinkRegistry.sol:ProLinkRegistry";
      },
    ],
    [
      "zero runtime",
      (v: any) => {
        v.sources[0].bootstrapManifest.artifacts.linkRegistry.runtimeCodeHash =
          consentHash(0);
      },
    ],
    [
      "source alias",
      (v: any) => {
        v.sources[0].bootstrapManifest.artifacts.linkRegistry.address =
          v.sources[0].factory;
      },
    ],
    [
      "duplicate source",
      (v: any) => {
        v.sources.push(v.sources[0]);
      },
    ],
  ])("rejects %s before any RPC", (_, mutate) => {
    const f = consentIndexerFixture();
    const value = f.raw();
    mutate(value);
    expect(() => parseProConsentIndexerSources(value)).toThrow(
      "Pro consent source",
    );
  });
  it("rejects accessors without evaluating them", () => {
    const f = consentIndexerFixture();
    const raw = f.raw();
    Object.defineProperty(raw.sources[0], "helper", {
      enumerable: true,
      get() {
        throw new Error("accessor evaluated");
      },
    });
    expect(() => parseProConsentIndexerSources(raw)).toThrow("accessor fields");
  });
});

describe("reviewed quote allowlists in consent manifests", () => {
  const quoteAddress = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
  const quote = (n = 0x9000) => ({ address: quoteAddress(n), runtimeCodeHash: consentHash(88) });
  const reviewed = (quotes: unknown) => {
    const raw = consentIndexerFixture().raw();
    (raw.sources[0].bootstrapManifest as any).quotes = quotes;
    return raw;
  };
  it("preserves absent legacy quotes and freezes an explicit empty list", () => {
    expect(Object.hasOwn(parseProConsentIndexerSources(consentIndexerFixture().raw())[0]!.bootstrapManifest, "quotes")).toBe(false);
    const list = parseProConsentIndexerSources(reviewed([]))[0]!.bootstrapManifest.quotes!;
    expect(list).toEqual([]);
    expect(Object.isFrozen(list)).toBe(true);
  });
  it("captures and freezes reviewed quote address/hash data without sharing mutable records", () => {
    const input = [quote(), quote(0x9001)], raw = reviewed(input);
    const list = parseProConsentIndexerSources(raw)[0]!.bootstrapManifest.quotes!;
    expect(list).toEqual(input);
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.every(Object.isFrozen)).toBe(true);
    input[0]!.runtimeCodeHash = consentHash(99);
    expect(list[0]!.runtimeCodeHash).toBe(consentHash(88));
  });
  it("accepts the exact 64-quote bound", () => {
    expect(parseProConsentIndexerSources(reviewed(Array.from({ length: 64 }, (_, i) => quote(0x9000 + i))))[0]!.bootstrapManifest.quotes).toHaveLength(64);
  });
  it.each([
    ["undefined", (): undefined => undefined],
    ["not an array", () => ({ 0: quote() })],
    ["too many", () => Array.from({ length: 65 }, (_, i) => quote(0x9000 + i))],
    ["sparse array", () => new Array(1)],
    ["duplicate", () => [quote(), quote()]],
    ["zero address", () => [{ ...quote(), address: zeroAddress }]],
    ["invalid checksum", () => [{ ...quote(), address: "0x760AfE86E5dE5fa0Ee542fc7B7B713e1c5425701" }]],
    ["zero hash", () => [{ ...quote(), runtimeCodeHash: consentHash(0) }]],
    ["short hash", () => [{ ...quote(), runtimeCodeHash: "0x1234" }]],
    ["unknown quote field", () => [{ ...quote(), symbol: "WMON" }]],
    ["missing quote field", () => [{ address: quoteAddress(0x9000) }]],
    ["extra array key", () => Object.assign([quote()], { extra: true })],
  ] as const)("rejects %s quote data", (_, invalid) => {
    expect(() => parseProConsentIndexerSources(reviewed(invalid()))).toThrow("Pro consent source");
  });
  it("rejects quotes overlapping a reviewed source role", () => {
    const raw = reviewed([quote()]);
    (raw.sources[0].bootstrapManifest as any).quotes[0].address = raw.sources[0].bootstrapManifest.artifacts.linkRegistry.address;
    expect(() => parseProConsentIndexerSources(raw)).toThrow("quote");
  });
  it.each(["manifest", "array item", "quote field"] as const)("refuses a %s accessor without evaluating it", (where) => {
    const raw = reviewed([quote()]), manifest = raw.sources[0].bootstrapManifest as any;
    const getter = vi.fn(() => { throw new Error("accessor evaluated"); });
    if (where === "manifest") Object.defineProperty(manifest, "quotes", { enumerable: true, get: getter });
    if (where === "array item") Object.defineProperty(manifest.quotes, "0", { enumerable: true, get: getter });
    if (where === "quote field") Object.defineProperty(manifest.quotes[0], "address", { enumerable: true, get: getter });
    expect(() => parseProConsentIndexerSources(raw)).toThrow("Pro consent source");
    expect(getter).not.toHaveBeenCalled();
  });
});


// Exact frozen public deployment bytes: 2026-10-03 retained generation and 2026-10-06 production generation.
// Embedded here so the regression remains portable without ignored output files.
const frozenConsentGenerations = [
{ sha256: "a614863529cba832b63404091521f9bba7baac82eadc5a08036f3fc40bfaea00", raw: String.raw`{
  "schema": "xoox.pro-token.deployment",
  "version": 1,
  "chainId": "10143",
  "factory": "0x62E492fe66B14d4fd5B26fd89510BBbaF327be4d",
  "bootstrap": {
    "schema": "xoox.pro-bootstrap.reviewed-artifacts",
    "version": 3,
    "reviewId": "monad-testnet-10143-pro-e5660393c1fa26ef",
    "chainId": "10143",
    "factory": "0x62E492fe66B14d4fd5B26fd89510BBbaF327be4d",
    "configuration": {
      "price": true,
      "reactive": true,
      "peak": true
    },
    "artifacts": {
      "factory": {
        "artifact": "packages/contracts/src/pro/ProFactory.sol:ProFactory",
        "address": "0x62E492fe66B14d4fd5B26fd89510BBbaF327be4d",
        "runtimeCodeHash": "0x13e1dd687200d0c2a8e2c81db2fa88f4fddec865b50add9c7421536871f5d0c1"
      },
      "partnerRegistry": {
        "artifact": "packages/contracts/src/pro/ProPartnerRegistry.sol:ProPartnerRegistry",
        "address": "0xE18aDfaC325e8Ce6D49b95eB63FfC0E600223dF1",
        "runtimeCodeHash": "0x547dff76e0fa1e7ae009124e79a4506d8e82280e3fa3b93874f0c996e79a2c4f"
      },
      "marketCalendar": {
        "artifact": "packages/contracts/src/pro/ProMarketHours.sol:ProMarketHours",
        "address": "0xfd320ED621Ca593b0b733C6E7Ba40DdfBb817779",
        "runtimeCodeHash": "0xc75af90e542aa94cc16d29428d0091b32553ee29c603eac07fd5a3dacfeb3a25"
      },
      "ruleValidator": {
        "artifact": "packages/contracts/src/pro/ProRuleValidator.sol:ProRuleValidator",
        "address": "0x066eF477b567D279f63822Ba175e7811C9C79265",
        "runtimeCodeHash": "0x75f7bd4fc3ea0ee7e4b6672cc0517105a9a157697cb9d748f542b4ce9f84ae3f"
      },
      "tokenDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProTokenDeployer",
        "address": "0x66581e830e8A1C2662561A8F73fC38cD42EE425C",
        "runtimeCodeHash": "0xfce35679079550a9f02b3dfaa07e9dd773c98dd35a1036c005b8a92be03944be"
      },
      "policyDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProPolicyDeployer",
        "address": "0xb1221e0A5AA119144e0117ba3AeF232B109a0DE6",
        "runtimeCodeHash": "0x1b6e08c5c73d9c03a09e62a76ab7be089ce164f13ab60682438b60602e9e1e71"
      },
      "curveDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProCurveDeployer",
        "address": "0xB4017D7D2bDd797F72294018679aB0704B3F4a14",
        "runtimeCodeHash": "0x3a0755390cc477613ad7f2fba901c9b3de31d8d04880e798dfb8749b32e0f53c"
      },
      "router": {
        "artifact": "packages/contracts/src/pro/ProRouter.sol:ProRouter",
        "address": "0x73d0b0A561CbaC79326E90C8ff90D17cAcb54704",
        "runtimeCodeHash": "0xefb9a2e13b24e619d381fc52793824131cb7c43a2eafe72e9483942cbd976673"
      },
      "vaultDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProVaultDeployer",
        "address": "0x993F20072212b412EB8FDabe0fB0493F50B69779",
        "runtimeCodeHash": "0x44a06389ed51e0d6a6899c4c48f13e9a2dd33d6ee51800bd3704d05a9b219a71"
      },
      "vestingDeployer": {
        "artifact": "packages/contracts/src/pro/ProModuleDeployers.sol:ProVestingDeployer",
        "address": "0x89A7A53219Dc4F578C32a0255430Ef60c8103a70",
        "runtimeCodeHash": "0x43485d61133dcb8237522f014117e2b419d07abdad6e236381164b274785fe7b"
      },
      "slidingDeployer": {
        "artifact": "packages/contracts/src/pro/ProModuleDeployers.sol:ProSlidingDeployer",
        "address": "0x35BD10f691e0fF16b2a4742Ab0a1827B0f30f0ef",
        "runtimeCodeHash": "0xcbcabbf476a0725f2b5262c36352bdf6bce39b52e7169ff841ec2e0a2ff0db2c"
      },
      "priceOracle": {
        "artifact": "packages/contracts/src/pro/ProPriceOracle.sol:ProPriceOracle",
        "address": "0x955CfD56D3C670316AA979a32b9AeD2f8D531de2",
        "runtimeCodeHash": "0x64f3f96ab60d74f1d4127d5ed5525c5548a09613bafd565208d63e4f135546c3"
      },
      "reactiveDeployer": {
        "artifact": "packages/contracts/src/pro/ProReactiveDeployer.sol:ProReactiveDeployer",
        "address": "0x30d5560d37F6FF245E74C6B0cf35C087ED39EaB6",
        "runtimeCodeHash": "0xf86772730e3e897e395f17d2d72a9fa8333b7018d6bab35586893aa83e031212"
      },
      "linkRegistry": {
        "artifact": "packages/contracts/src/pro/ProLinkRegistryV2.sol:ProLinkRegistryV2",
        "address": "0x770AC3D10906284Fd6A0345f748561EA81ed00F9",
        "runtimeCodeHash": "0x5dffd95831aa37100290ff0a47def6c6fd9544177e4d5a3ebfc553f75ccb839b"
      },
      "peakDeployer": {
        "artifact": "packages/contracts/src/pro/ProPeakDeployer.sol:ProPeakDeployer",
        "address": "0xa5Db510652558F1a7a90d37f4591C3785806FEcf",
        "runtimeCodeHash": "0x4d75930fbecd4882ca7e8eb06761312209cb9b185deb7970c01e18b8db0ff539"
      },
      "peakRegistry": {
        "artifact": "packages/contracts/src/pro/ProPeakRegistry.sol:ProPeakRegistry",
        "address": "0xcd462Ef46Df6fb439e58780E9B2C73E73c839162",
        "runtimeCodeHash": "0x768d0915df503303be3abaa1c8b5f854a53657bfa66356b62c0a556f86755990"
      },
      "beaconDeployer": {
        "artifact": "packages/contracts/src/pro/ProPeakDeployer.sol:ProBeaconDeployer",
        "address": "0x75788c3398FCf715b4ae48b3268a6fcC68E9460D",
        "runtimeCodeHash": "0x5a0d96d5e133faefa1aecc2e300ea85459e8ddeeb7be4e1e076c585f92141e01"
      },
      "entangledDeployer": {
        "artifact": "packages/contracts/src/pro/ProPeakDeployer.sol:ProEntangledDeployer",
        "address": "0xb3aCE37aA4420F00240e2421dCfef78eAbaB0413",
        "runtimeCodeHash": "0x28938faae2187fcc87fb0b0162465c75f81b805c6e9cdeb3a7cfcc760ca17785"
      },
      "reactiveValidationChild": {
        "artifact": "packages/contracts/src/pro/ProReactiveValidation.sol:ProReactiveValidation",
        "address": "0xBBc9A2f5A633e0D2040470eFDA2Ea0ba0b039e60",
        "runtimeCodeHash": "0xc3cfff62a14a7637fe97ecb17e0c4c257f03e3b82cc5b01d5ea77d0de115da6c"
      }
    }
  },
  "graduation": {
    "schema": "xoox.pro-graduation.reviewed-artifacts",
    "version": 1,
    "reviewId": "monad-testnet-10143-pro-e5660393c1fa26ef",
    "chainId": "10143",
    "factory": "0x62E492fe66B14d4fd5B26fd89510BBbaF327be4d",
    "artifacts": {
      "factory": {
        "artifact": "packages/contracts/src/pro/ProFactory.sol:ProFactory",
        "runtimeCodeHash": "0x13e1dd687200d0c2a8e2c81db2fa88f4fddec865b50add9c7421536871f5d0c1"
      },
      "partnerRegistry": {
        "artifact": "packages/contracts/src/pro/ProPartnerRegistry.sol:ProPartnerRegistry",
        "runtimeCodeHash": "0x547dff76e0fa1e7ae009124e79a4506d8e82280e3fa3b93874f0c996e79a2c4f"
      },
      "registry": {
        "artifact": "packages/contracts/src/pro/ProGraduationRegistry.sol:ProGraduationRegistry",
        "runtimeCodeHash": "0x6736befcd0f330b6231eed9e8ba97de28782503e43f791c7ffe2dad57af4e468"
      },
      "guard": {
        "artifact": "packages/contracts/src/GraduationGuard.sol:GraduationGuard",
        "runtimeCodeHash": "0xfd231873d6a8e75bf95af37d0063b18b06e634f2b69e0a3e4d710398015c921e"
      },
      "verifier": {
        "artifact": "packages/contracts/src/pro/ProGraduationVerifier.sol:ProGraduationVerifier",
        "runtimeCodeHash": "0x96a55fdc18601dbb3e4d1cb231ad54e1bbc318b058fbb18417dce9baa72d70c0"
      },
      "executor": {
        "artifact": "packages/contracts/src/pro/ProGraduationExecutor.sol:ProGraduationExecutor",
        "runtimeCodeHash": "0xd5869051427d558be331cb9cd0d6cf179970e6760cbd0fb8e2fe800d55b1281d"
      },
      "hook": {
        "artifact": "packages/contracts/src/pro/ProGraduationHook.sol:ProGraduationHook",
        "runtimeCodeHash": "0xec4365d0af42535e3c5b943e5c28d56bfc6985f621798218051a9507e0a10f21"
      },
      "poolManager": {
        "artifact": "v4-core/src/PoolManager.sol:PoolManager",
        "runtimeCodeHash": "0xb6e5b28eb3342b19f888464b816d67a22e5fbd51f085c9ecdf848929e7e4f06f"
      },
      "positionManager": {
        "artifact": "v4-periphery/src/PositionManager.sol:PositionManager",
        "runtimeCodeHash": "0x5aa368b83926a0193c0a861877fb0b2c6c4b5dfaef1a06d360914c23dee946f3"
      },
      "permit2": {
        "artifact": "permit2/src/Permit2.sol:Permit2",
        "runtimeCodeHash": "0xb1d4a65236d7d01b8f21aa1391dfb08503b9bf920cf5ce1830a98ecd3c8de276"
      },
      "locker": {
        "artifact": "packages/contracts/src/LaunchLocker.sol:LaunchLocker",
        "runtimeCodeHash": "0x009bc79f854b597df59b896565ca23579a2beda99e2e7a08ee7cad47ed3eb213"
      }
    }
  },
  "poolTrading": {
    "schema": "xoox.pro-pool-trading.reviewed-artifacts",
    "version": 1,
    "reviewId": "monad-testnet-10143-pro-e5660393c1fa26ef",
    "chainId": "10143",
    "factory": "0x62E492fe66B14d4fd5B26fd89510BBbaF327be4d",
    "router": {
      "artifact": "packages/contracts/src/pro/ProSwapRouter.sol:ProSwapRouter",
      "address": "0xa83E9C6eA7bEE27329B6320127b6Ea421F7a0BcF",
      "runtimeCodeHash": "0x9032c9f4603e040ee17732cc54e9fe65742653be7e7e33a3ac4e4cec8d2be375"
    }
  }
}
` },
{ sha256: "2ba3ca0be2321d8c4f9877234864c5f971410364b104aee152a9e4a38f90fbc8", raw: String.raw`{
  "schema": "xoox.pro-token.deployment",
  "version": 1,
  "chainId": "10143",
  "factory": "0x0df97DB808585d23d6333A713C8E7F9396f85779",
  "bootstrap": {
    "schema": "xoox.pro-bootstrap.reviewed-artifacts",
    "version": 3,
    "reviewId": "monad-testnet-10143-pro-fd557f7465d1fedc",
    "chainId": "10143",
    "factory": "0x0df97DB808585d23d6333A713C8E7F9396f85779",
    "configuration": {
      "price": true,
      "reactive": true,
      "peak": true
    },
    "quotes": [
      {
        "address": "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",
        "runtimeCodeHash": "0xa32df4f1226f1bb0d6ce9b917752ed687857899a35ebf902c9992edb73b138b6"
      }
    ],
    "artifacts": {
      "factory": {
        "artifact": "packages/contracts/src/pro/ProFactory.sol:ProFactory",
        "address": "0x0df97DB808585d23d6333A713C8E7F9396f85779",
        "runtimeCodeHash": "0xb3f3e9cb8c6972ca409077f8a0bb2005a2735f477908bd1212cd8a571b6b5ef6"
      },
      "partnerRegistry": {
        "artifact": "packages/contracts/src/pro/ProPartnerRegistry.sol:ProPartnerRegistry",
        "address": "0xc4B65105F60E100a19EE1CA444e21B4C7281438e",
        "runtimeCodeHash": "0xdc2d162189da99c3fd6c2f99446270edb78e887a138ac26dd71da7c45a23cedf"
      },
      "marketCalendar": {
        "artifact": "packages/contracts/src/pro/ProMarketHours.sol:ProMarketHours",
        "address": "0x6a82811aa5A68cecDe4c699F62930Dc8053CF3e5",
        "runtimeCodeHash": "0x8a42aa5007b46ec6874dc3a2639375bdca0c908228d5ab60d596394029bbe2a7"
      },
      "ruleValidator": {
        "artifact": "packages/contracts/src/pro/ProRuleValidator.sol:ProRuleValidator",
        "address": "0x9e269d6d853a4eA040Da55c64E455353463B4400",
        "runtimeCodeHash": "0xf8bcf7e0c7e8869a6a4ffd282601133e5c7435d1da9c432ae55db96cdeeaf5da"
      },
      "tokenDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProTokenDeployer",
        "address": "0x26bcAb3989Cf0336d12524a12b4dD82E849ADB05",
        "runtimeCodeHash": "0xe82cf62b1282f9d00a57e16333a4d2caa44f4f3c69eef248a185d3cf8b7a1020"
      },
      "policyDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProPolicyDeployer",
        "address": "0xB558B07888B5cA2Ed62620D70959589365f0d8E8",
        "runtimeCodeHash": "0xe50dbec95cbb23fb5772f3fe0f843abe3e800ddd886e2a1c784a2b611be8e51f"
      },
      "curveDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProCurveDeployer",
        "address": "0xF5fE749BD84d93d0561d43d259aC15Fc6F4afe7C",
        "runtimeCodeHash": "0xe7d8cdd57328d8612864ab2c4f0a81cefacf1f32a6082fa8b8dcc9fa16df35e8"
      },
      "router": {
        "artifact": "packages/contracts/src/pro/ProRouter.sol:ProRouter",
        "address": "0x10efaee2cf70080b1AEA1051Ec4249639F0c2fdA",
        "runtimeCodeHash": "0x712b2a18641afd81ec6bd11c47618427c6136ee95c83141826e2b47f6add32e4"
      },
      "vaultDeployer": {
        "artifact": "packages/contracts/src/pro/ProDeployers.sol:ProVaultDeployer",
        "address": "0xA34EBF03053f77a77b0127062D82afA38e3c2233",
        "runtimeCodeHash": "0x7ee92bad56afa452cd2da4c0de6da5994ea7221213ca983e1fce765589d4d70c"
      },
      "vestingDeployer": {
        "artifact": "packages/contracts/src/pro/ProModuleDeployers.sol:ProVestingDeployer",
        "address": "0x7AbbfED2732dBcC50b406456DF415dafea130d91",
        "runtimeCodeHash": "0x3b879775bc27f5f6e2fd21a94c14de7b6ad069c7381249150397c4b1e9c2342e"
      },
      "slidingDeployer": {
        "artifact": "packages/contracts/src/pro/ProModuleDeployers.sol:ProSlidingDeployer",
        "address": "0x7638f7Ef3C6A126dB6E06911A22E35453f3d1C89",
        "runtimeCodeHash": "0xc86017a00b886bc369ecc05f7f03b6378e0950e654747b8b459258fda7db937b"
      },
      "priceOracle": {
        "artifact": "packages/contracts/src/pro/ProPriceOracle.sol:ProPriceOracle",
        "address": "0x955CfD56D3C670316AA979a32b9AeD2f8D531de2",
        "runtimeCodeHash": "0x64f3f96ab60d74f1d4127d5ed5525c5548a09613bafd565208d63e4f135546c3"
      },
      "reactiveDeployer": {
        "artifact": "packages/contracts/src/pro/ProReactiveDeployer.sol:ProReactiveDeployer",
        "address": "0x4EDC8B165833A76b83348437c06712a55E9cC9d9",
        "runtimeCodeHash": "0xd8df840b310e3d464fb3315b13f748bf228bd4af5fad193e7fa24c912a181f3e"
      },
      "linkRegistry": {
        "artifact": "packages/contracts/src/pro/ProLinkRegistryV2.sol:ProLinkRegistryV2",
        "address": "0xabe97F8F42b0820D57974ccD3B542936Cebd5c49",
        "runtimeCodeHash": "0x6882bab43a0007256276120d59d261d833e0473e31a3ab4d38a197a70f00269e"
      },
      "peakDeployer": {
        "artifact": "packages/contracts/src/pro/ProPeakDeployer.sol:ProPeakDeployer",
        "address": "0xf9c6550744CAa1514F9d7D2b545BB2ABB34F319A",
        "runtimeCodeHash": "0xc43a49c8167b3375b900e0c762fd2cd8dd2918e7c8131a3328653b188b7592d0"
      },
      "peakRegistry": {
        "artifact": "packages/contracts/src/pro/ProPeakRegistry.sol:ProPeakRegistry",
        "address": "0x248B38595c87710ceA3C1fd4a0E071AdD0811D60",
        "runtimeCodeHash": "0x46170b58284d4cc527432797ed8cc002aaaf7e15ab5b754e86fb606ae35142d7"
      },
      "beaconDeployer": {
        "artifact": "packages/contracts/src/pro/ProPeakDeployer.sol:ProBeaconDeployer",
        "address": "0x9564A4B1cE47A9D1905241B9630FA6B4B1d9A868",
        "runtimeCodeHash": "0xab1527f77ad799156a5b9f485177286766e6ba513af5592bf401d7c8f1389f84"
      },
      "entangledDeployer": {
        "artifact": "packages/contracts/src/pro/ProPeakDeployer.sol:ProEntangledDeployer",
        "address": "0xC64A37693D2D2e69f55a80D5d73a91cF5112f9EF",
        "runtimeCodeHash": "0x898b6b016323957fc44e10c27dded59dc987d34d044221e6bf48a57546c14e84"
      },
      "reactiveValidationChild": {
        "artifact": "packages/contracts/src/pro/ProReactiveValidation.sol:ProReactiveValidation",
        "address": "0xf3bdC4F68Ac9d537b27a6fE600C6a7e9f1cbDa0F",
        "runtimeCodeHash": "0xc3cfff62a14a7637fe97ecb17e0c4c257f03e3b82cc5b01d5ea77d0de115da6c"
      }
    }
  },
  "graduation": {
    "schema": "xoox.pro-graduation.reviewed-artifacts",
    "version": 1,
    "reviewId": "monad-testnet-10143-pro-fd557f7465d1fedc",
    "chainId": "10143",
    "factory": "0x0df97DB808585d23d6333A713C8E7F9396f85779",
    "artifacts": {
      "factory": {
        "artifact": "packages/contracts/src/pro/ProFactory.sol:ProFactory",
        "runtimeCodeHash": "0xb3f3e9cb8c6972ca409077f8a0bb2005a2735f477908bd1212cd8a571b6b5ef6"
      },
      "partnerRegistry": {
        "artifact": "packages/contracts/src/pro/ProPartnerRegistry.sol:ProPartnerRegistry",
        "runtimeCodeHash": "0xdc2d162189da99c3fd6c2f99446270edb78e887a138ac26dd71da7c45a23cedf"
      },
      "registry": {
        "artifact": "packages/contracts/src/pro/ProGraduationRegistry.sol:ProGraduationRegistry",
        "runtimeCodeHash": "0xfe9056885f475122032a52ec5900ae218b1eb39d2f8e195afd971d6fa1d4af33"
      },
      "guard": {
        "artifact": "packages/contracts/src/GraduationGuard.sol:GraduationGuard",
        "runtimeCodeHash": "0xfd231873d6a8e75bf95af37d0063b18b06e634f2b69e0a3e4d710398015c921e"
      },
      "verifier": {
        "artifact": "packages/contracts/src/pro/ProGraduationVerifier.sol:ProGraduationVerifier",
        "runtimeCodeHash": "0x67d890b4ce8946d36df807de3d217e73c030ca9403e8b0e15ad74981c2ae58bd"
      },
      "executor": {
        "artifact": "packages/contracts/src/pro/ProGraduationExecutor.sol:ProGraduationExecutor",
        "runtimeCodeHash": "0x6e22318352ab6092a9e89a7ac3569625d1ffdd59e35036fa95bf88909f8b8906"
      },
      "hook": {
        "artifact": "packages/contracts/src/pro/ProGraduationHook.sol:ProGraduationHook",
        "runtimeCodeHash": "0x62cf6617f0f6530ab283ba6a7febca025ae2581c167364c30b2bc4ef6effdf07"
      },
      "poolManager": {
        "artifact": "v4-core/src/PoolManager.sol:PoolManager",
        "runtimeCodeHash": "0xb6e5b28eb3342b19f888464b816d67a22e5fbd51f085c9ecdf848929e7e4f06f"
      },
      "positionManager": {
        "artifact": "v4-periphery/src/PositionManager.sol:PositionManager",
        "runtimeCodeHash": "0x5aa368b83926a0193c0a861877fb0b2c6c4b5dfaef1a06d360914c23dee946f3"
      },
      "permit2": {
        "artifact": "permit2/src/Permit2.sol:Permit2",
        "runtimeCodeHash": "0xb1d4a65236d7d01b8f21aa1391dfb08503b9bf920cf5ce1830a98ecd3c8de276"
      },
      "locker": {
        "artifact": "packages/contracts/src/LaunchLocker.sol:LaunchLocker",
        "runtimeCodeHash": "0x009bc79f854b597df59b896565ca23579a2beda99e2e7a08ee7cad47ed3eb213"
      }
    }
  },
  "poolTrading": {
    "schema": "xoox.pro-pool-trading.reviewed-artifacts",
    "version": 1,
    "reviewId": "monad-testnet-10143-pro-fd557f7465d1fedc",
    "chainId": "10143",
    "factory": "0x0df97DB808585d23d6333A713C8E7F9396f85779",
    "router": {
      "artifact": "packages/contracts/src/pro/ProSwapRouter.sol:ProSwapRouter",
      "address": "0xB9f41d04fC7e50808316b924C78A392b53a55838",
      "runtimeCodeHash": "0x9aa3b89fff3883371427d1e40be9b24f8a93ce10f691a1fd78b77ed1217a1e24"
    }
  }
}
` }
];
const frozenConsentSources = () => ({
  schema: "xoox.pro-token.indexer-consent-sources",
  version: 1,
  sources: frozenConsentGenerations.map((frozen) => {
    if (createHash("sha256").update(frozen.raw).digest("hex") !== frozen.sha256) throw new Error("Frozen manifest bytes changed.");
    const manifest = JSON.parse(frozen.raw);
    return { chainId: manifest.chainId, factory: manifest.factory, helper: manifest.bootstrap.artifacts.reactiveDeployer.address, registry: manifest.bootstrap.artifacts.linkRegistry.address, bootstrapManifest: manifest.bootstrap };
  }),
});
describe("both genuine frozen consent generations", () => {
  it("preserves the generation 2 quotes and permits only the identical reviewed shared price oracle", () => {
    const raw = frozenConsentSources(), parsed = parseProConsentIndexerSources(raw);
    expect(parsed).toHaveLength(2);
    expect(Object.hasOwn(parsed[0]!.bootstrapManifest, "quotes")).toBe(false);
    expect(parsed[1]!.bootstrapManifest.quotes).toEqual(raw.sources[1]!.bootstrapManifest.quotes);
    expect(Object.isFrozen(parsed[1]!.bootstrapManifest.quotes)).toBe(true);
    expect(parsed[1]!.bootstrapManifest.quotes!.every(Object.isFrozen)).toBe(true);
    expect(parsed[0]!.bootstrapManifest.artifacts.priceOracle).toEqual(parsed[1]!.bootstrapManifest.artifacts.priceOracle);
    expect(parsed[0]!.bootstrapManifest.configuration).toEqual(parsed[1]!.bootstrapManifest.configuration);
    for (const [index, source] of parsed.entries()) {
      expect(source.helper).toBe(raw.sources[index]!.bootstrapManifest.artifacts.reactiveDeployer.address);
      expect(source.registry).toBe(raw.sources[index]!.bootstrapManifest.artifacts.linkRegistry.address);
    }
  });
  it.each(["different hash", "different artifact", "cross-role alias", "other duplicate"] as const)("refuses %s across frozen source graphs", (fault) => {
    const raw = frozenConsentSources(), old = raw.sources[0]!.bootstrapManifest, current = raw.sources[1]!.bootstrapManifest;
    if (fault === "different hash") current.artifacts.priceOracle.runtimeCodeHash = consentHash(99);
    if (fault === "different artifact") current.artifacts.priceOracle.artifact = "UnreviewedOracle.sol:UnreviewedOracle";
    if (fault === "cross-role alias") current.artifacts.marketCalendar.address = old.artifacts.priceOracle.address;
    if (fault === "other duplicate") current.artifacts.marketCalendar = { ...old.artifacts.marketCalendar };
    expect(() => parseProConsentIndexerSources(raw)).toThrow("Pro consent source");
  });
  it("refuses shared oracle source flags that differ", () => {
    const raw = frozenConsentSources(), current = raw.sources[1]!.bootstrapManifest;
    current.configuration.peak = false;
    for (const role of ["peakDeployer", "peakRegistry", "beaconDeployer", "entangledDeployer"]) delete current.artifacts[role];
    expect(() => parseProConsentIndexerSources(raw)).toThrow("priceOracle");
  });
  it.each(["earlier role", "later role"] as const)("refuses a quote overlapping an %s", (order) => {
    const raw = frozenConsentSources();
    if (order === "earlier role") raw.sources[1]!.bootstrapManifest.quotes[0].address = raw.sources[0]!.bootstrapManifest.artifacts.marketCalendar.address;
    else raw.sources[0]!.bootstrapManifest.quotes = [{ address: raw.sources[1]!.factory, runtimeCodeHash: consentHash(88) }];
    expect(() => parseProConsentIndexerSources(raw)).toThrow("Pro consent source");
  });
});

describe("canonical genuine Registry participant source", () => {
  it("issues pending facts through the actual Bootstrap v3 wire reader and never selects latest", async () => {
    const f = consentIndexerFixture();
    const result = await readProConsentSource(
      f.client,
      143,
      f.source(),
      f.input(),
    );
    expect(result).toMatchObject({
      factory: f.factory.toLowerCase(),
      registry: f.registry.toLowerCase(),
      participants: [{ id: f.ids[0], nonce: 0n, finalized: false, role: 0 }],
      pairs: [],
    });
    expect(f.calls.some((call) => call.method === "eth_blockNumber")).toBe(
      false,
    );
    for (const call of f.calls.filter((value) =>
      ["eth_call", "eth_getCode"].includes(value.method),
    ))
      expect(call.params![1]).toEqual({
        blockHash: f.base.blockHash,
        requireCanonical: true,
      });
  });
  it("allows later same-block nonce/finalization while retaining the requested own IDs", async () => {
    const f = consentIndexerFixture();
    f.participants[0]!.nonce = 2n;
    f.finalize(2n, 0n);
    const result = await readProConsentSource(
      f.client,
      143,
      f.source(),
      f.input(f.ids),
    );
    expect(result.participants.map((p) => p.nonce)).toEqual([3n, 1n]);
    expect(result.pairs[0]).toMatchObject({
      id: f.finalPairId,
      creator0: f.creators[0],
      creator1: f.creators[1],
    });
  });
  it.each([
    "Factory hash",
    "Registry hash",
    "child hash",
    "version",
    "helper getter",
  ])("refuses %s drift", async (fault) => {
    const f = consentIndexerFixture();
    if (fault.endsWith("hash")) {
      const role =
        fault === "Factory hash"
          ? "factory"
          : fault === "Registry hash"
            ? "linkRegistry"
            : "reactiveValidationChild";
      f.base.codes.set(f.base.components[role].toLowerCase(), "0x6001");
    } else if (fault === "version")
      f.base.set(f.factory, "reactiveParticipantVersion", 1n);
    else f.base.set(f.helper, "reactiveConsentVersion", 1n);
    await expect(
      readProConsentSource(f.client, 143, f.source(), f.input()),
    ).rejects.toThrow();
  });
  it.each([
    "creator",
    "configuration",
    "own ID",
    "rule role",
    "curve",
    "pending relationship",
    "trailing ABI",
  ])("rejects %s mismatch", async (fault) => {
    const f = consentIndexerFixture();
    if (fault === "creator")
      f.set(f.factory, "creatorOf", f.creators[1], [f.tokens[0]]);
    if (fault === "configuration")
      f.set(f.factory, "configurationHash", consentHash(99), [f.tokens[0]]);
    if (fault === "own ID")
      f.set(f.registry, "participantOfToken", f.ids[1], [f.tokens[0]]);
    if (fault === "rule role") f.participants[0]!.role = 1;
    if (fault === "curve")
      f.set(f.factory, "curveOf", zeroAddress, [f.tokens[0]]);
    if (fault === "pending relationship")
      f.participants[0]!.partnerId = f.ids[1];
    if (fault === "trailing ABI") f.control.malformed = true;
    await expect(
      readProConsentSource(f.client, 143, f.source(), f.input()),
    ).rejects.toThrow();
  });
  it.each([
    "opposite role",
    "opposite partner",
    "ordered pair",
    "derived pair",
    "own link",
  ])("rejects finalized %s mismatch", async (fault) => {
    const f = consentIndexerFixture();
    f.finalize();
    if (fault === "opposite role") f.participants[1]!.role = 0;
    if (fault === "opposite partner")
      f.participants[1]!.partnerId = consentHash(99);
    if (fault === "ordered pair") f.pair.participantId0 = f.ids[1];
    if (fault === "derived pair")
      f.set(f.registry, "deriveFinalPairId", consentHash(99), f.ids);
    if (fault === "own link")
      f.set(f.registry, "linkOfToken", consentHash(99), [f.tokens[0]]);
    await expect(
      readProConsentSource(f.client, 143, f.source(), f.input(f.ids)),
    ).rejects.toThrow();
  });
  it.each(["chain", "hash", "timestamp", "height", "unsupported selector"])(
    "rejects canonical %s mismatch without fallback",
    async (fault) => {
      const f = consentIndexerFixture();
      if (fault === "chain") f.base.control.finalChain = "0x7a69";
      if (fault === "hash") f.base.control.finalHash = consentHash(99);
      if (fault === "timestamp") f.base.control.finalTimestamp = "0x3e9";
      if (fault === "height") f.base.control.finalNumber = "0x7c";
      if (fault === "unsupported selector")
        f.base.control.rejectCanonical = true;
      await expect(
        readProConsentSource(f.client, 143, f.source(), f.input()),
      ).rejects.toThrow();
    },
  );
  it("rechecks the event header after participant acquisition", async () => {
    const f = consentIndexerFixture();
    let calls = 0;
    f.control.before = (method) => {
      if (method === "eth_getBlockByNumber" && ++calls === 4)
        f.base.control.finalHash = consentHash(99);
    };
    await expect(
      readProConsentSource(f.client, 143, f.source(), f.input()),
    ).rejects.toThrow("canonical");
  });
  it("captures mutable caller input before the first async boundary", async () => {
    const f = consentIndexerFixture();
    const input = { ...f.input(), participantIds: [...f.ids] };
    f.control.before = () => {
      input.registry = zeroAddress;
      input.participantIds[0] = consentHash(99);
      input.blockHash = consentHash(99);
    };
    expect(
      (
        await readProConsentSource(f.client, 143, f.source(), input)
      ).participants.map((p) => p.id),
    ).toEqual(f.ids);
  });
});

describe("private manifest plus explicit subscription loader", () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });
  async function configure() {
    const f = consentIndexerFixture();
    directory = await mkdtemp(join(tmpdir(), "xoox-consent-source-"));
    const sourcePath = join(directory, "sources.json"),
      configPath = join(directory, "config.yaml");
    const config = {
      chains: [
        {
          id: 143,
          rpc: [{ url: "http://127.0.0.1:1" }],
          contracts: [
            { name: "ProFactory", address: [f.factory] },
            { name: "ProConsentRegistry", address: [f.registry] },
          ],
        },
      ],
    };
    await writeFile(sourcePath, JSON.stringify(f.raw()));
    await writeFile(configPath, JSON.stringify(config));
    vi.stubEnv("XOOX_PRO_CONSENT_SOURCES_PATH", sourcePath);
    vi.stubEnv("ENVIO_CONFIG", configPath);
    return { f, config, sourcePath, configPath };
  }
  it("requires both private reviewed manifest and actual static subscriptions", async () => {
    const { f } = await configure();
    const client = vi.fn(() => f.client);
    expect((await loadProConsentSource(143, f.input(), client)).reviewId).toBe(
      "reviewed-bootstrap-fixture-v3",
    );
    expect(client).toHaveBeenCalledWith("http://127.0.0.1:1");
  });
  it("refuses unconfigured service without RPC", async () => {
    vi.stubEnv("XOOX_PRO_CONSENT_SOURCES_PATH", "");
    const f = consentIndexerFixture(),
      client = vi.fn(() => f.client);
    await expect(loadProConsentSource(143, f.input(), client)).rejects.toThrow(
      "explicit absolute",
    );
    expect(client).not.toHaveBeenCalled();
  });
  it.each([
    "missing Registry",
    "wrong Registry",
    "missing Factory",
    "duplicate chain",
    "wrong chain",
    "missing RPC",
    "non-HTTP RPC",
  ])("rejects %s before constructing a client", async (fault) => {
    const { f, config, configPath } = await configure();
    const chain = config.chains[0]!;
    if (fault === "missing Registry") chain.contracts.pop();
    if (fault === "wrong Registry") chain.contracts[1]!.address = [f.factory];
    if (fault === "missing Factory") chain.contracts.shift();
    if (fault === "duplicate chain") config.chains.push(chain);
    if (fault === "wrong chain") chain.id = 31337;
    if (fault === "missing RPC") chain.rpc = [];
    if (fault === "non-HTTP RPC") chain.rpc = [{ url: "file:///tmp/source" }];
    await writeFile(configPath, JSON.stringify(config));
    const client = vi.fn(() => f.client);
    await expect(loadProConsentSource(143, f.input(), client)).rejects.toThrow(
      "Pro consent source",
    );
    expect(client).not.toHaveBeenCalled();
  });
  it("bounds private operator JSON before parsing", async () => {
    const { f, sourcePath } = await configure();
    await writeFile(sourcePath, "x".repeat(1024 * 1024 + 1));
    await expect(
      loadProConsentSource(143, f.input(), () => f.client),
    ).rejects.toThrow("oversized");
  });
});

describe("actual configuration declaration guards", () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });
  async function config(value: ReturnType<typeof envioConfiguration>) {
    directory = await mkdtemp(join(tmpdir(), "xoox-consent-declarations-"));
    const path = join(directory, "config.yaml");
    await writeFile(path, JSON.stringify(value));
    vi.stubEnv("ENVIO_CONFIG", path);
    return path;
  }
  it("leaves the genuine active legacy configuration unregistered and imports existing handlers without any RPC", () => {
    const active = fileURLToPath(
      new URL(
        "../test-fixtures/local-rehearsal/local-31337.config.json",
        import.meta.url,
      ),
    );
    vi.stubEnv("ENVIO_CONFIG", active);
    expect(proStandardIndexerContractsConfigured()).toBe(false);
    expect(proConsentContractConfigured()).toBe(false);
    const require = createRequire(import.meta.url);
    const loader = require.resolve("tsx/esm");
    const source = fileURLToPath(
      new URL("./handlers/index.ts", import.meta.url),
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--import",
          loader,
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(source)});`,
        ],
        {
          env: { ...process.env, ENVIO_CONFIG: active },
          stdio: "pipe",
          timeout: 10_000,
        },
      ),
    ).not.toThrow();
  });
  it("retains ordinary/PoolRouter and consent declarations in explicit disabled codegen", async () => {
    await config(envioConfiguration());
    expect(proStandardIndexerContractsConfigured()).toBe(true);
    expect(proConsentContractConfigured()).toBe(true);
  });
  it.each(["duplicate", "changed ABI", "partial old roles"])(
    "rejects %s declaration before registering handlers",
    async (fault) => {
      const value = structuredClone(envioConfiguration());
      if (fault === "duplicate")
        value.contracts.push(
          value.contracts.find((c) => c.name === "ProConsentRegistry")!,
        );
      if (fault === "changed ABI")
        value.contracts.find(
          (c) => c.name === "ProConsentRegistry",
        )!.events[0] = { event: "Invented(bool allowed)" };
      if (fault === "partial old roles")
        value.chains[0].contracts = value.chains[0].contracts.filter(
          (c) => c.name !== "ProSwapRouter",
        );
      await config(value);
      expect(() =>
        fault === "partial old roles"
          ? proStandardIndexerContractsConfigured()
          : proConsentContractConfigured(),
      ).toThrow("Pro consent source");
    },
  );
});
