import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layering, as an assertion rather than a convention.
 *
 * Dependencies point inward. The domain knows nothing; the application knows
 * the domain and the shapes of its ports; the adapters know everything and are
 * known by nothing. `main.ts` is the one place allowed to meet both sides,
 * because deciding which adapter fills which port is the one thing that cannot
 * be done from inside.
 *
 *     ui ─────┐
 *             ├──> app ──> domain
 *     adapters┘      ^
 *                    └── ports live here; adapters implement them
 *
 * `@nonchalant/core` is the language the application is written in, so it
 * belongs at every level above the domain. `@nonchalant/dom` and
 * `@nonchalant/wire` are choices about rendering and transport, so they are
 * adapter concerns and stay out of `app/`.
 *
 * If a rule here starts getting in the way, the useful question is whether the
 * dependency is really necessary or whether a port is missing.
 */

const SRC = join(process.cwd(), "src");

interface Layer {
  /** Directory under `src/`. */
  dir: string;
  /** Import specifiers this layer may not contain, and why. */
  forbidden: { pattern: RegExp; why: string }[];
}

const LAYERS: Layer[] = [
  {
    dir: "domain",
    forbidden: [
      { pattern: /^@nonchalant\//, why: "the domain predates any framework" },
      { pattern: /^~\/(app|adapters|ui|test)\b/, why: "the domain depends on nothing" },
    ],
  },
  {
    dir: "app",
    forbidden: [
      { pattern: /^@nonchalant\/(dom|wire)/, why: "rendering and transport are adapter choices" },
      { pattern: /^~\/(adapters|ui)\b/, why: "the application is given its adapters, it does not reach for them" },
    ],
  },
  {
    dir: "ui",
    forbidden: [
      { pattern: /^@nonchalant\/wire/, why: "a view does not know where state comes from" },
      { pattern: /^~\/adapters\b/, why: "a view is handed processes, not devices" },
    ],
  },
];

/** Every `.ts` file under `dir`, excluding tests - the rules bind the code. */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(path);
      }
    }
  };
  walk(join(SRC, dir));
  return out;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return Array.from(text.matchAll(IMPORT), (match: RegExpMatchArray) =>
    String(match[1])
  );
}

describe.each(LAYERS)("$dir", (layer) => {
  const files = sources(layer.dir);

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(layer.forbidden)("does not import $pattern - $why", (rule) => {
    const offenders = files.flatMap((file) =>
      importsOf(file)
        .filter((specifier) => rule.pattern.test(specifier))
        .map(
          (specifier) =>
            `${relative(SRC, file).split(sep).join("/")} imports ${specifier}`
        )
    );
    expect(offenders).toEqual([]);
  });
});

describe("relative imports", () => {
  it("stay inside their own layer - crossing one is spelled with ~/", () => {
    const escaping = LAYERS.flatMap((layer) =>
      sources(layer.dir).flatMap((file) =>
        importsOf(file)
          .filter((specifier) => specifier.startsWith("../"))
          .map(
            (specifier) =>
              `${relative(SRC, file).split(sep).join("/")} imports ${specifier}`
          )
      )
    );
    // `adapters/` is not in LAYERS - it is the outside, and may reach anywhere.
    expect(escaping).toEqual([]);
  });
});
