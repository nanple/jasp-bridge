#!/usr/bin/env Rscript
# JASP-Bridge one-shot runner.
# Usage: Rscript --vanilla run_analysis.R request.json data.csv result.json

args <- commandArgs(trailingOnly = TRUE)

scriptArg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)[1]
scriptDir <- if (!is.na(scriptArg)) dirname(normalizePath(sub("^--file=", "", scriptArg))) else getwd()
source(file.path(scriptDir, "analysis_core.R"))

# jsonlite lives in the bundled runtime, so make it visible before writing errors.
runtime <- Sys.getenv("JASP_RUNTIME", unset = "")
if (!nzchar(runtime) || !dir.exists(runtime)) {
  runtime <- file.path(Sys.getenv("USERPROFILE"), ".workbuddy", "jasp-bridge", "runtime")
}
if (dir.exists(runtime)) {
  .libPaths(c(file.path(runtime, "lib"), file.path(runtime, "R", "library"), .libPaths()))
}

write_result <- function(payload) {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    cat("jsonlite is not installed\n", file = stderr())
    quit(save = "no", status = 2)
  }
  jsonlite::write_json(
    payload,
    args[[3]],
    auto_unbox = TRUE,
    pretty = TRUE,
    dataframe = "rows",
    null = "null",
    na = "null"
  )
}

fail <- function(message, call = NULL) {
  write_result(list(status = "error", message = message, call = call))
  quit(save = "no", status = 0)
}

main <- function() {
  if (length(args) < 3) fail("Usage: Rscript run_analysis.R request.json data.csv result.json")

  runtime <- Sys.getenv("JASP_RUNTIME", unset = "")
  if (!nzchar(runtime) || !dir.exists(runtime)) {
    runtime <- file.path(Sys.getenv("USERPROFILE"), ".workbuddy", "jasp-bridge", "runtime")
  }

  request <- jsonlite::fromJSON(args[[1]], simplifyVector = FALSE)
  request$data_path <- args[[2]]
  if (is.null(request$output_dir) || !nzchar(request$output_dir)) {
    request$output_dir <- dirname(args[[3]])
    dir.create(request$output_dir, recursive = TRUE, showWarnings = FALSE)
  }

  jb_load_runtime(runtime)
  result <- jb_run_analysis(request, runtime)
  result$runtime <- runtime
  write_result(result)
}

tryCatch(
  main(),
  error = function(error) {
    fail(
      conditionMessage(error),
      paste(deparse(conditionCall(error)), collapse = " ")
    )
  }
)
