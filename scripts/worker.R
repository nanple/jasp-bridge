#!/usr/bin/env Rscript
# Persistent JASP-Bridge worker.
# Protocol: one JSON request per line on stdin, one JSON response per line on stdout.
# First line on stdout is READY after the runtime is loaded.

scriptArg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)[1]
scriptDir <- if (!is.na(scriptArg)) dirname(normalizePath(sub("^--file=", "", scriptArg))) else getwd()
source(file.path(scriptDir, "analysis_core.R"))

runtime <- Sys.getenv("JASP_RUNTIME", unset = "")
if (!nzchar(runtime) || !dir.exists(runtime)) {
  runtime <- file.path(Sys.getenv("USERPROFILE"), ".workbuddy", "jasp-bridge", "runtime")
}

ok <- tryCatch({
  jb_load_runtime(runtime)
  TRUE
}, error = function(error) {
  cat("WORKER_ERROR ", conditionMessage(error), "\n", file = stderr())
  FALSE
})

if (!ok) quit(save = "no", status = 2)

# Rscript on Windows binds stdin() to the script file; file("stdin") reads the pipe.
jb_stdin <- file("stdin", open = "r")
on.exit(close(jb_stdin), add = TRUE)

writeLines("READY", con = stdout())
flush(stdout())

repeat {
  line <- readLines(jb_stdin, n = 1, warn = FALSE)
  if (length(line) == 0) break
  if (!nzchar(line)) next

  request <- tryCatch(
    jsonlite::fromJSON(line, simplifyVector = FALSE),
    error = function(error) {
      writeLines(
        jb_to_json(list(status = "error", message = conditionMessage(error))),
        con = stdout()
      )
      flush(stdout())
      NULL
    }
  )
  if (is.null(request)) next
  if (identical(request$command, "shutdown")) break

  response <- NULL
  invisible(capture.output({
    response <- tryCatch(
      jb_run_analysis(request, runtime),
      error = function(error) {
        list(
          status = "error",
          analysis = request$name,
          message = conditionMessage(error)
        )
      }
    )
  }, type = "output"))

  response$id <- request$id
  response$runtime <- runtime

  writeLines(jb_to_json(response), con = stdout())
  flush(stdout())
}
