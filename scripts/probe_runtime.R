runtime <- Sys.getenv("JASP_RUNTIME", unset = "")
if (!nzchar(runtime)) {
  runtime <- file.path(Sys.getenv("USERPROFILE"), ".workbuddy", "jasp-bridge", "runtime")
}

.libPaths(c(
  file.path(runtime, "lib"),
  file.path(runtime, "R", "library")
))

ok <- tryCatch({
  suppressPackageStartupMessages(library(jaspTools))
  TRUE
}, error = function(error) {
  cat("ERR=", conditionMessage(error), "\n", sep = "")
  FALSE
})

if (ok) {
  cat(
    "R=", R.version.string,
    "|jaspTools=", as.character(utils::packageVersion("jaspTools")),
    "|runtime=", runtime,
    "|ok\n",
    sep = ""
  )
}
