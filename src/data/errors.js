export class IngestUserError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = "IngestUserError";
    this.code = code;
    this.extra = extra;
  }
}

export function isIngestUserError(error) {
  return error instanceof IngestUserError || error?.name === "IngestUserError";
}

export function listSheets(names) {
  if (!names || names.length === 0) return "（无）";
  return names.map((name, index) => `${index + 1}. ${name}`).join("；");
}
