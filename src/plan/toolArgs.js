import { z } from "zod";
import {
  coerceBooleanInput,
  coerceOptions,
  coerceStringArray,
  isArrayLikeObject,
} from "./coerce.js";

export const booleanArg = (description) =>
  z.preprocess(coerceBooleanInput, z.boolean().optional()).describe(description);

export const variableRolesArg = z.preprocess((value) => {
  if (value === undefined) return value;
  if (!value || typeof value !== "object" || Array.isArray(value) || isArrayLikeObject(value)) {
    return value;
  }
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "") continue;
    if (Array.isArray(item) || isArrayLikeObject(item) || typeof item === "string") {
      next[key] = coerceStringArray(item);
    } else {
      next[key] = item;
    }
  }
  return next;
}, z.record(z.array(z.string())));

export const optionsArg = z.preprocess((value) => {
  if (value === undefined) return value;
  return coerceOptions(value);
}, z.record(z.any()));
