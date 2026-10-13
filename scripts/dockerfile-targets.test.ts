import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../Dockerfile", import.meta.url)),
  "utf8",
);
const ignore = readFileSync(
  fileURLToPath(new URL("../.dockerignore", import.meta.url)),
  "utf8",
);

/** Instructions per stage, comments and blank lines dropped, line continuations joined. */
function stages(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] = [];
  for (const line of source
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((text) => text.trim())) {
    if (!line || line.startsWith("#")) continue;
    const from = /^FROM\s+\S+\s+AS\s+(\S+)$/i.exec(line);
    if (from) {
      current = [line];
      result.set(from[1] as string, current);
    } else if (/^FROM\b/i.test(line)) {
      throw new Error(`FROM without a stage name: ${line}`);
    } else {
      current.push(line);
    }
  }
  return result;
}

describe("Dockerfile", () => {
  const all = stages();
  const indexer = all.get("indexer") as string[];

  it("keeps the stage order, with the indexer as the default, last target", () => {
    expect([...all.keys()]).toEqual(["base", "build", "indexer"]);
    expect(indexer[0]).toBe("FROM base AS indexer");
  });

  it("pins the Node base image by digest and installs the locked workspace", () => {
    expect(source).toMatch(
      /^ARG NODE_BASE=node:24\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m,
    );
    expect((all.get("base") as string[])[0]).toBe("FROM ${NODE_BASE} AS base");
    expect(all.get("base")).toContain(
      "RUN npm install --global pnpm@10.17.0 && rm -rf /root/.npm",
    );
    const build = all.get("build") as string[];
    expect(build).toContain("RUN pnpm install --frozen-lockfile");
    // The manifests and the lockfile arrive before the install, so the dependency layer survives source-only releases.
    expect(build.indexOf("RUN pnpm install --frozen-lockfile")).toBeLessThan(
      build.indexOf("COPY src/ src/"),
    );
  });

  it("adds psql and the CA bundle to the indexer image", () => {
    const install = indexer.filter((line) => line.startsWith("RUN apt-get"));
    expect(install).toHaveLength(1);
    expect(install[0]).toMatch(
      /apt-get install -y --no-install-recommends ca-certificates postgresql-client\b/,
    );
    expect(install[0]).toContain("rm -rf /var/lib/apt/lists/*");
    expect(indexer).toContain(
      'LABEL io.xoox.release.independent="true" io.xoox.release.service="indexer"',
    );
  });

  it("starts the indexer image only through launch.sh, which runs the guard before Envio", () => {
    const last = indexer.slice(-2);
    expect(last).toEqual([
      "USER node",
      'CMD ["sh", "/workspace/scripts/launch.sh"]',
    ]);
    // Exec form, no ENTRYPOINT: nothing can prepend or replace the launcher with a different command line.
    expect(indexer.some((line) => line.startsWith("ENTRYPOINT"))).toBe(false);
    // The workspace, guard files included, belongs to node, not root, and the image never switches back to root.
    expect(indexer).toContain(
      "COPY --from=build --chown=node:node /workspace /workspace",
    );
    expect(indexer).not.toContain("USER root");
    expect(
      (all.get("build") as string[]).some((line) => line.startsWith("CMD")),
    ).toBe(false);
  });

  it("ships the guard with the workspace and nothing that holds a credential", () => {
    const build = (all.get("build") as string[]).join("\n");
    expect(build).toContain("COPY scripts/ scripts/");
    expect(build).not.toMatch(/\.env|config\.testnet|private/);
    const lines = ignore.split("\n").map((line) => line.trim());
    expect(lines).toContain("*");
    expect(lines).toContain("!scripts");
    expect(lines).toContain("!scripts/**");
    // Exceptions come before the credential exclusions, which must keep the last word.
    expect(lines.indexOf("!scripts/**")).toBeLessThan(
      lines.indexOf("**/.env"),
    );
    expect(lines).toContain("**/.env");
    expect(lines).toContain("**/.env.*");
    expect(lines).toContain("config.yaml");
    expect(lines).toContain("**/config.testnet.unified.yaml");
  });

  it("keeps the indexer image free of the build-only heap setting", () => {
    for (const name of ["build", "indexer"])
      expect(
        (all.get(name) as string[]).some((line) =>
          line.includes("NODE_OPTIONS"),
        ),
      ).toBe(false);
  });
});
