import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {inspectLicenseEvidence, inspectDevelopmentEvidence, readEvidence} from "./evidence-gates.mjs";

const root = fileURLToPath(new URL("./packages/platform/", import.meta.url));

test("actual fixed inventory validates 672 components and distinguishes 10 absent upstream files", () => {
  const result = inspectLicenseEvidence(root);
  assert.equal(result.components, 672);
  assert.equal(result.missing.length, 0);
  assert.equal(result.upstreamLicenseFilesMissing.length, 10);
  assert(result.upstreamLicenseFilesMissing.includes("fxhash@0.2.1"));
  assert.equal(result.legalApproval, false);
  assert.equal(new Set(result.missing).size, result.missing.length);
});

test("current artifact without source-bound execution evidence is not accepted", () => {
  const result = inspectDevelopmentEvidence(root);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /UPSTREAM-DEVELOPMENT-GATE-FAIL/);
  assert.match(result.reason, /development-execution/);
  assert.doesNotMatch(result.reason, /runner is not implemented/);
});

test("evidence paths reject absolute, traversal, empty and platform aliases", () => {
  for (const path of ["", "/etc/passwd", "../LICENSE", "licenses/../LICENSE", "./LICENSE", "licenses//LICENSE", "licenses/..\\LICENSE", "licenses/\0LICENSE", "x".repeat(513)]) {
    assert.throws(() => readEvidence(root, path), undefined, JSON.stringify(path));
  }
});

test("evidence rejects directories and real files larger than the explicit bound", () => {
  assert.throws(() => readEvidence(root, "licenses"), /size\/type/);
  assert.throws(() => readEvidence(root, "provenance/cargo-tree-depth.txt", 1), /size\/type/);
});

test("a real included original license has the declared digest", () => {
  const sbom = JSON.parse(readEvidence(root, "provenance/sbom.cdx.json"));
  const material = JSON.parse(sbom.components[0].properties.find(p => p.name === "licenseMaterials").value)[0];
  assert.equal(createHash("sha256").update(readEvidence(root, material.path)).digest("hex"), material.sha256);
});
