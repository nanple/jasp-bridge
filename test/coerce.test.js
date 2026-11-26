import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  coerceBoolean,
  coerceBooleanInput,
  coerceOptions,
  coerceStringArray,
  coerceVariableRoles,
  isArrayLikeObject,
} from "../src/plan/coerce.js";
import { booleanArg, optionsArg, variableRolesArg } from "../src/plan/toolArgs.js";
import { buildPlan, normalizeVariables } from "../src/plan/planner.js";
import { buildRequest } from "../src/plan/spec.js";
import { ingestText } from "../src/data/ingest.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("legacy Zod schemas reject host-mangled arrays and boolean strings", () => {
  const legacy = z.object({
    session_id: z.string(),
    variables: z.record(z.array(z.string())).optional(),
    options: z.record(z.any()).optional(),
    confirm: z.boolean().optional(),
  });

  const asObject = legacy.safeParse({
    session_id: "s_demo",
    variables: { variables: { "0": "item_a", "1": "item_b", "2": "item_c" } },
  });
  assert.equal(asObject.success, false);
  assert.equal(asObject.error.issues[0].code, "invalid_type");
  assert.match(asObject.error.issues[0].message, /expected array/i);

  const boolString = legacy.safeParse({ session_id: "s_demo", confirm: "false" });
  assert.equal(boolString.success, false);
  assert.match(boolString.error.issues[0].message, /expected boolean/i);

  const optionString = legacy.safeParse({
    session_id: "s_demo",
    options: { shapiroWilkTest: "false", matrixPlot: true },
  });
  assert.equal(optionString.success, true);
  assert.equal(optionString.data.options.shapiroWilkTest, "false");
});

test("new tool schemas coerce array-like objects and true/false strings", () => {
  const schema = z.object({
    session_id: z.string(),
    variables: variableRolesArg.optional(),
    options: optionsArg.optional(),
    confirm: booleanArg("confirm"),
    force: booleanArg("force"),
  });

  const parsed = schema.parse({
    session_id: "s_demo",
    variables: { variables: { "0": "item_a", "1": "item_b", "2": "item_c" } },
    options: { shapiroWilkTest: "false", matrixPlot: "false", valid: true },
    confirm: "true",
    force: "false",
  });

  assert.deepEqual(parsed.variables.variables, ["item_a", "item_b", "item_c"]);
  assert.equal(parsed.options.shapiroWilkTest, false);
  assert.equal(parsed.options.matrixPlot, false);
  assert.equal(parsed.options.valid, true);
  assert.equal(parsed.confirm, true);
  assert.equal(parsed.force, false);
});

test("single string role values become one-item arrays; empty boolean args stay optional", () => {
  const schema = z.object({
    variables: variableRolesArg.optional(),
    confirm: booleanArg("confirm"),
  });
  const parsed = schema.parse({ variables: { dependent: "perf" } });
  assert.deepEqual(parsed.variables.dependent, ["perf"]);
  assert.equal(parsed.confirm, undefined);
});

test("garbage boolean strings are still rejected", () => {
  const schema = z.object({ confirm: booleanArg("confirm") });
  const parsed = schema.safeParse({ confirm: "yes-please" });
  assert.equal(parsed.success, false);
});

test("coerce helpers: array-like detection and option walks", () => {
  assert.equal(isArrayLikeObject({ 0: "a", 1: "b" }), true);
  assert.equal(isArrayLikeObject({ variables: ["a"] }), false);
  assert.equal(isArrayLikeObject({}), false);
  assert.deepEqual(coerceStringArray({ 0: "a", 1: "b" }), ["a", "b"]);
  assert.deepEqual(coerceVariableRoles({ dependent: { 0: "y" }, group: "g" }), {
    dependent: ["y"],
    group: ["g"],
  });
  assert.equal(coerceBoolean("FALSE"), false);
  assert.equal(coerceBooleanInput(""), undefined);
  const options = coerceOptions({
    shapiroWilkTest: "false",
    variables: { 0: "item_a", 1: "item_b" },
    nest: { flag: "true", names: ["keep_true_string"] },
  });
  assert.equal(options.shapiroWilkTest, false);
  assert.deepEqual(options.variables, ["item_a", "item_b"]);
  assert.equal(options.nest.flag, true);
  assert.deepEqual(options.nest.names, ["keep_true_string"]);
});

test("buildRequest coerces string booleans before they reach JASP", () => {
  const request = buildRequest({
    id: "p_demo",
    revision: 1,
    session_id: "s_demo",
    analysis: "descriptives",
    jasp: { analysis: "Descriptives", module: "jaspDescriptives" },
    options: {
      variables: ["item_a", "item_b"],
      shapiroWilkTest: "false",
      matrixPlot: "false",
    },
  });
  assert.equal(request.options.shapiroWilkTest, false);
  assert.equal(request.options.matrixPlot, false);
  assert.deepEqual(request.options.variables, ["item_a", "item_b"]);
});

test("buildPlan accepts array-like role maps and string option flags", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-coerce-"));
  const csv = "id,item_a,item_b,item_c\n1,4,5,3\n2,5,4,4\n3,3,4,5\n";
  const data = ingestText(csv, { outDir, name: "demo" });
  const plan = buildPlan({
    session: { id: "s_demo", data },
    utterance: "对题项做描述统计",
    analysis: "descriptives",
    variables: { variables: { 0: "item_a", 1: "item_b", 2: "item_c" } },
    options: { shapiroWilkTest: "false", matrixPlot: "false" },
  });
  assert.deepEqual(plan.variables.variables, ["item_a", "item_b", "item_c"]);
  assert.equal(plan.options.shapiroWilkTest, false);
  assert.equal(plan.options.matrixPlot, false);
  assert.equal(plan.status, "proposed");
  assert.deepEqual(normalizeVariables({ variables: { 0: "item_a", 1: "item_b" } }), {
    variables: ["item_a", "item_b"],
  });
});
