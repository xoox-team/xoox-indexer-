// Vendored from the XOOX SDK; only what the indexer uses.
import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

export const PRO_REACTIVE_PARTICIPANT_DOMAIN = keccak256(
  stringToHex("XOOX_PRO_REACTIVE_PARTICIPANT_V2"),
);
export const PRO_REACTIVE_CONSENT_PAIR_DOMAIN = keccak256(
  stringToHex("XOOX_PRO_REACTIVE_CONSENT_PAIR_V2"),
);
export const PRO_REACTIVE_CONSENT_NAME = "XOOX Pro Reactive Consent" as const;
export const PRO_REACTIVE_CONSENT_VERSION = "2" as const;

export const proReactiveConsentAbi = parseAbi([
  "function reactiveConsentVersion() view returns(uint256)",
  "function reactiveParticipantVersion() view returns(uint256)",
  "function PARTICIPANT_DOMAIN() view returns(bytes32)",
  "function FINAL_PAIR_DOMAIN() view returns(bytes32)",
  "function CONSENT_TYPEHASH() view returns(bytes32)",
  "function deriveParticipantId(address creator,bytes32 participantSalt,uint8 role) view returns(bytes32)",
  "function participantOfToken(address token) view returns(bytes32)",
  "function participant(bytes32 id) view returns((address creator,address token,bytes32 configurationHash,uint8 role,uint256 nonce,bytes32 partnerId,bytes32 finalPairId,bool finalized))",
  "function finalPairIdOfParticipant(bytes32 id) view returns(bytes32)",
  "function deriveFinalPairId(bytes32 id0,bytes32 id1) view returns(bytes32)",
  "function finalPair(bytes32 id) view returns((bytes32 participantId0,bytes32 participantId1,address token0,address token1,bytes32 configurationHash0,bytes32 configurationHash1,address creator0,address creator1))",
  "function consentDigest((address factory,uint256 protocolVersion,bytes32 participantId0,bytes32 participantId1,address token0,address token1,bytes32 configurationHash0,bytes32 configurationHash1,address creator0,address creator1,uint256 nonce0,uint256 nonce1,uint64 deadline,bytes32 finalPairId) consent) view returns(bytes32)",
  "function finalizeConsent((address factory,uint256 protocolVersion,bytes32 participantId0,bytes32 participantId1,address token0,address token1,bytes32 configurationHash0,bytes32 configurationHash1,address creator0,address creator1,uint256 nonce0,uint256 nonce1,uint64 deadline,bytes32 finalPairId) consent,bytes signature0,bytes signature1)",
  "function revokeConsent(bytes32 id)",
  "event ReactiveParticipantRegistered(bytes32 indexed participantId,address indexed token,address indexed creator,bytes32 configurationHash,uint8 role,bytes32 participantSalt)",
  "event ParticipantNonceAdvanced(bytes32 indexed participantId,address indexed creator,uint256 nonce)",
  "event ReactiveConsentFinalized(bytes32 indexed finalPairId,bytes32 indexed participantId0,bytes32 indexed participantId1,address token0,address token1,address creator0,address creator1,uint256 nonce0,uint256 nonce1)",
]);

export type ProReactiveConsentDomain = Readonly<{
  chainId: bigint;
  factory: Address;
  registry: Address;
}>;
export type ProReactiveParticipantIdentity = Readonly<{
  participantId: Hex;
  token: Address;
  configurationHash: Hex;
}>;
export type ProReactiveParticipantConsent = Readonly<{
  factory: Address;
  protocolVersion: 2n;
  participantId0: Hex;
  participantId1: Hex;
  token0: Address;
  token1: Address;
  configurationHash0: Hex;
  configurationHash1: Hex;
  creator0: Address;
  creator1: Address;
  nonce0: bigint;
  nonce1: bigint;
  deadline: bigint;
  finalPairId: Hex;
}>;

const consentFields = [
  ["factory", "address"],
  ["protocolVersion", "uint256"],
  ["participantId0", "bytes32"],
  ["participantId1", "bytes32"],
  ["token0", "address"],
  ["token1", "address"],
  ["configurationHash0", "bytes32"],
  ["configurationHash1", "bytes32"],
  ["creator0", "address"],
  ["creator1", "address"],
  ["nonce0", "uint256"],
  ["nonce1", "uint256"],
  ["deadline", "uint64"],
  ["finalPairId", "bytes32"],
] as const;
export const proReactiveConsentTypes = Object.freeze({
  ParticipantConsent: Object.freeze(
    consentFields.map(([name, type]) => Object.freeze({ name, type })),
  ),
});

function require_(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error("Reactive consent " + message + ".");
}
function address(value: unknown, label: string): Address {
  require_(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      value.toLowerCase() !== zeroAddress,
    label + " requires a nonzero address",
  );
  return getAddress(value);
}
function word(value: unknown, label: string, allowZero = false): Hex {
  require_(
    typeof value === "string" &&
      /^0x[\da-fA-F]{64}$/.test(value) &&
      (allowZero || value.toLowerCase() !== zeroHash),
    label + " requires a " + (allowZero ? "" : "nonzero ") + "bytes32 value",
  );
  return value.toLowerCase() as Hex;
}
function uint(
  value: unknown,
  label: string,
  bits = 256,
  positive = false,
): bigint {
  require_(
    typeof value === "bigint" &&
      value >= (positive ? 1n : 0n) &&
      value < 1n << BigInt(bits),
    label + " exceeds its exact integer range",
  );
  return value as bigint;
}
function domain(value: ProReactiveConsentDomain): ProReactiveConsentDomain {
  const result = Object.freeze({
    chainId: uint(value.chainId, "chain ID", 256, true),
    factory: address(value.factory, "Factory"),
    registry: address(value.registry, "Registry"),
  });
  require_(result.factory !== result.registry, "Factory and Registry alias");
  return result;
}
function identity(
  value: ProReactiveParticipantIdentity,
): ProReactiveParticipantIdentity {
  return Object.freeze({
    participantId: word(value.participantId, "participant ID"),
    token: address(value.token, "participant token"),
    configurationHash: word(value.configurationHash, "configuration hash"),
  });
}

/** Input-only hash codec. Source issuance and genesis support must be checked independently. */
export function deriveProReactiveParticipantId(
  context: ProReactiveConsentDomain,
  creator: Address,
  participantSalt: Hex,
  role: 0 | 1,
): Hex {
  const d = domain(context);
  require_(role === 0 || role === 1, "role must be 0 or 1");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,uint256,address,address,uint256,address,bytes32,uint8",
      ),
      [
        PRO_REACTIVE_PARTICIPANT_DOMAIN,
        d.chainId,
        d.factory,
        d.registry,
        2n,
        address(creator, "creator"),
        word(participantSalt, "participant salt", true),
        role,
      ],
    ),
  );
}

/** Ordered shared relationship commitment, separate from either immutable participant ID. */
export function deriveProReactiveConsentPairId(
  context: ProReactiveConsentDomain,
  first: ProReactiveParticipantIdentity,
  second: ProReactiveParticipantIdentity,
): Hex {
  const d = domain(context),
    a = identity(first),
    b = identity(second);
  require_(
    a.participantId !== b.participantId && a.token !== b.token,
    "participants must be distinct",
  );
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,uint256,address,address,uint256,bytes32,bytes32,address,address,bytes32,bytes32",
      ),
      [
        PRO_REACTIVE_CONSENT_PAIR_DOMAIN,
        d.chainId,
        d.factory,
        d.registry,
        2n,
        a.participantId,
        b.participantId,
        a.token,
        b.token,
        a.configurationHash,
        b.configurationHash,
      ],
    ),
  );
}

/** Frozen EIP-712 codec only; this does not prove participants, nonces, expiry or creator authority on chain. */
export function encodeProReactiveConsentTypedData(
  context: ProReactiveConsentDomain,
  value: ProReactiveParticipantConsent,
) {
  const d = domain(context);
  require_(
    !!value &&
      typeof value === "object" &&
      Reflect.ownKeys(value).length === consentFields.length &&
      consentFields.every(([name]) => Object.hasOwn(value, name)),
    "message requires exact consent fields",
  );
  require_(value.protocolVersion === 2n, "protocol version must be 2");
  const message: ProReactiveParticipantConsent = Object.freeze({
    factory: address(value.factory, "message Factory"),
    protocolVersion: 2n,
    participantId0: word(value.participantId0, "role 0 ID"),
    participantId1: word(value.participantId1, "role 1 ID"),
    token0: address(value.token0, "role 0 token"),
    token1: address(value.token1, "role 1 token"),
    configurationHash0: word(value.configurationHash0, "role 0 configuration"),
    configurationHash1: word(value.configurationHash1, "role 1 configuration"),
    creator0: address(value.creator0, "role 0 creator"),
    creator1: address(value.creator1, "role 1 creator"),
    nonce0: uint(value.nonce0, "role 0 nonce"),
    nonce1: uint(value.nonce1, "role 1 nonce"),
    deadline: uint(value.deadline, "deadline", 64, true),
    finalPairId: word(value.finalPairId, "final pair ID"),
  });
  require_(
    message.factory === d.factory,
    "message Factory differs from signing domain",
  );
  const expected = deriveProReactiveConsentPairId(
    d,
    {
      participantId: message.participantId0,
      token: message.token0,
      configurationHash: message.configurationHash0,
    },
    {
      participantId: message.participantId1,
      token: message.token1,
      configurationHash: message.configurationHash1,
    },
  );
  require_(message.finalPairId === expected, "final pair commitment differs");
  return Object.freeze({
    domain: Object.freeze({
      name: PRO_REACTIVE_CONSENT_NAME,
      version: PRO_REACTIVE_CONSENT_VERSION,
      chainId: d.chainId,
      verifyingContract: d.registry,
    }),
    types: proReactiveConsentTypes,
    primaryType: "ParticipantConsent" as const,
    message,
  });
}

export function hashProReactiveConsent(
  context: ProReactiveConsentDomain,
  message: ProReactiveParticipantConsent,
): Hex {
  return hashTypedData(encodeProReactiveConsentTypedData(context, message));
}
