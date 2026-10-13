import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProIndexerSource } from "./configuration";

const MAX_PRO_SOURCES = 6;
const MAX_SOURCE_BYTES = 16 * 1024;
const sourceError = () =>
  new Error(
    "Reviewed Pro source file must contain a JSON array of at most 6 explicitly reviewed sources within 16 KiB.",
  );

/** Operator-selected reviewed records only. This loader never discovers addresses or start blocks. */
export async function readReviewedProIndexerSources(
  path?: string,
): Promise<readonly ProIndexerSource[]> {
  if (path === undefined) return [];
  if (!path.trim() || path.includes("\0")) throw sourceError();
  try {
    const file = await open(resolve(path), "r");
    let bytesRead = 0;
    const bytes = Buffer.alloc(MAX_SOURCE_BYTES + 1);
    try {
      while (bytesRead < bytes.length) {
        const result = await file.read(
          bytes,
          bytesRead,
          bytes.length - bytesRead,
          null,
        );
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
    } finally {
      await file.close();
    }
    if (bytesRead > MAX_SOURCE_BYTES) throw sourceError();
    const raw: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytesRead),
      ),
    );
    if (!Array.isArray(raw) || raw.length > MAX_PRO_SOURCES)
      throw sourceError();
    // envioConfiguration validates every explicit record and its factory/router/registry pairing.
    return raw;
  } catch {
    throw sourceError();
  }
}
