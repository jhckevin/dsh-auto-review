// Development-only acceptance. Never treat a self-reported status as execution proof.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {isAbsolute, join, relative, resolve, sep} from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {inspectExecutedDevelopmentEvidence} from "./development-evidence.mjs";

const GRAPH_SHA256 = "3dc5c8c6df7305ed896fd364a00ae5466677500e90c8d6663552fa894349b851";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Evidence lives under a fixed, operator-controlled staging root, not an agent path.
// Reject symlinks in every package-relative segment, not only in the final file.
export function readEvidence(root, path, maximum = 8 * 1024 * 1024) {
  assert.equal(typeof path, "string", "evidence path must be a string");
  assert(path.length > 0 && path.length <= 512 && !isAbsolute(path));
  const parts = path.split("/");
  assert(parts.every(part => part && part !== "." && part !== ".." && !part.includes("\\") && !part.includes("\0")), "unsafe evidence path");
  const base = realpathSync(root);
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    assert(!lstatSync(current).isSymbolicLink(), "symlink evidence is forbidden");
  }
  const rel = relative(base, resolve(current));
  assert(rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
  const stat = lstatSync(current);
  assert(stat.isFile() && stat.size > 0 && stat.size <= maximum, "invalid evidence file size/type");
  const bytes = readFileSync(current);
  assert(bytes.length <= maximum, "evidence exceeded size limit");
  return bytes;
}

export function inspectLicenseEvidence(root) {
  // Recompute source-bound declarations; a status JSON cannot authorize coverage.
  const supplemental = JSON.parse(execFileSync("python3", [
    fileURLToPath(new URL("./license-evidence.py", import.meta.url)), "--platform-root", root,
  ], {encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024}));
  const graph = readEvidence(root, "provenance/cargo-tree-depth.txt");
  assert.equal(hash(graph), GRAPH_SHA256, "unreviewed target dependency graph");
  const expected = new Map();
  for (const line of graph.toString("utf8").trimEnd().split("\n")) {
    const match = /^(\d+)(\S+) v([^ ]+)(.*?)\|(.+?)(?: \(\*\))?$/.exec(line);
    assert(match, "invalid cargo dependency row");
    const ref = match[2] + "@" + match[3];
    if (expected.has(ref)) assert.equal(expected.get(ref), match[5], "conflicting dependency license");
    expected.set(ref, match[5]);
  }
  const audit = JSON.parse(readEvidence(root, "provenance/license-audit.json"));
  const sbom = JSON.parse(readEvidence(root, "provenance/sbom.cdx.json"));
  assert.equal(audit.sourceGraphSha256, GRAPH_SHA256);
  assert(Array.isArray(sbom.components));
  assert.equal(sbom.components.length, expected.size, "SBOM does not cover fixed graph");
  assert.equal(audit.components, expected.size);
  const seen = new Set();
  const missing = [];
  for (const component of sbom.components) {
    const ref = component["bom-ref"];
    assert.equal(ref, component.name + "@" + component.version);
    assert(expected.has(ref) && !seen.has(ref), "unknown or duplicate SBOM component");
    seen.add(ref);
    assert.deepEqual(component.licenses, [{expression: expected.get(ref)}]);
    assert(Array.isArray(component.properties), "missing component properties");
    const properties = component.properties.filter(p => p.name === "licenseMaterials");
    assert.equal(properties.length, 1, "every component requires exactly one licenseMaterials property");
    assert.equal(typeof properties[0].value, "string");
    const materials = JSON.parse(properties[0].value);
    assert(Array.isArray(materials), "licenseMaterials must be an array");
    const detail = supplemental.components[ref];
    if (detail !== undefined) {
      assert.deepEqual(materials, detail.materials, "source-bound distributed material inventory mismatch");
      assert.deepEqual(component.properties.filter(p => p.name === "licenseMaterialSourceType"),
        [{name: "licenseMaterialSourceType", value: detail.sourceType}], "license source classification mismatch");
    }
    if (!materials.length || !expected.get(ref).trim() || expected.get(ref) === "UNKNOWN") {
      missing.push(ref + ": missing license text/expression");
    }
    const paths = new Set();
    for (const material of materials) {
      assert(material && typeof material === "object" && !Array.isArray(material));
      assert.deepEqual(Object.keys(material).sort(), ["path", "sha256"]);
      assert.equal(typeof material.path, "string");
      assert(material.path.startsWith("licenses/" + ref + "/"), "material must belong to its component");
      assert(!paths.has(material.path), "duplicate license material");
      paths.add(material.path);
      assert.equal(typeof material.sha256, "string");
      assert(/^[a-f0-9]{64}$/.test(material.sha256));
      assert.equal(hash(readEvidence(root, material.path)), material.sha256, "license material hash mismatch");
    }
  }
  assert.equal(seen.size, expected.size);
  assert(Array.isArray(audit.missing));
  assert.deepEqual([...audit.missing].sort(), [...missing].sort(), "self-reported license audit disagrees with files");
  assert.deepEqual(audit.upstreamLicenseFilesMissing, supplemental.upstreamLicenseFilesMissing,
    "original upstream license availability must remain explicit");
  assert.equal(audit.legalApproval, false, "material gate cannot certify legal sufficiency");
  return {components: seen.size, missing, upstreamLicenseFilesMissing: supplemental.upstreamLicenseFilesMissing,
    supplementalSourceTypes: Object.fromEntries(Object.entries(supplemental.components).map(([ref, row]) => [ref, row.sourceType])),
    legalApproval: false};
}

export function inspectDevelopmentEvidence(root) {
  // Legacy status/evidence strings are not acceptance inputs. The fixed execution
  // directory must bind actual complete command records to this artifact manifest.
  return inspectExecutedDevelopmentEvidence(root);
}
