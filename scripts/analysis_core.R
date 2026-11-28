# Shared JASP-Bridge analysis core.
# Used by both run_analysis.R (one-shot) and worker.R (persistent process).

jb_module_map <- list(
  "Descriptives" = list(bundle = "jaspDescriptives", pkg = "jaspDescriptives"),
  "TTestIndependentSamples" = list(bundle = "jaspTTests", pkg = "jaspTTests"),
  "TTestPairedSamples" = list(bundle = "jaspTTests", pkg = "jaspTTests"),
  "Anova" = list(bundle = "jaspAnova", pkg = "jaspAnova"),
  "Ancova" = list(bundle = "jaspAnova", pkg = "jaspAnova"),
  "AnovaRepeatedMeasures" = list(bundle = "jaspAnova", pkg = "jaspAnova"),
  "RegressionLinear" = list(bundle = "jaspRegression", pkg = "jaspRegression"),
  "Correlation" = list(bundle = "jaspRegression", pkg = "jaspRegression"),
  "reliabilityUnidimensionalFrequentist" = list(bundle = "jaspReliability", pkg = "jaspReliability"),
  "ClassicProcess" = list(bundle = "jaspProcess", pkg = "jaspProcess"),
  "BayesianProcess" = list(bundle = "jaspProcess", pkg = "jaspProcess"),
  "exploratoryFactorAnalysis" = list(bundle = "jaspFactor", pkg = "jaspFactor"),
  "principalComponentAnalysis" = list(bundle = "jaspFactor", pkg = "jaspFactor"),
  "confirmatoryFactorAnalysis" = list(bundle = "jaspFactor", pkg = "jaspFactor"),
  "SEM" = list(bundle = "jaspSem", pkg = "jaspSem"),
  "PLSSEM" = list(bundle = "jaspSem", pkg = "jaspSem"),
  "MIMIC" = list(bundle = "jaspSem", pkg = "jaspSem"),
  "LatentGrowthCurve" = list(bundle = "jaspSem", pkg = "jaspSem"),
  "MixedModelsLMM" = list(bundle = "jaspMixedModels", pkg = "jaspMixedModels"),
  "MixedModelsGLMM" = list(bundle = "jaspMixedModels", pkg = "jaspMixedModels"),
  "MixedModelsBLMM" = list(bundle = "jaspMixedModels", pkg = "jaspMixedModels"),
  "MixedModelsBGLMM" = list(bundle = "jaspMixedModels", pkg = "jaspMixedModels")
)

jb_anova_force_null <- c(
  "contrasts", "customContrasts", "marginalMeanTerms",
  "restrictedMarginalMeanTerms", "restrictedModels", "kruskalWallisFactors",
  "betweenSubjectFactors", "withinModelTerms", "betweenModelTerms",
  "singleModelTerms", "wlsWeights", "covariates", "randomFactors",
  "descriptivePlotHorizontalAxis", "descriptivePlotSeparateLines",
  "descriptivePlotSeparatePlot", "barPlotHorizontalAxis", "barPlotSeparatePlots",
  "rainCloudHorizontalAxis", "rainCloudSeparatePlots"
)

# Repeated measures: the compiled defaults point at a factor literally named
# "RM Factor 1". Keep them out of the request unless the plan names it too.
jb_rm_force_null <- c(
  "contrasts", "customContrasts", "marginalMeanTerms",
  "restrictedMarginalMeanTerms", "restrictedModels",
  "kruskalWallisFactors",
  "descriptivePlotHorizontalAxis", "descriptivePlotSeparateLines",
  "descriptivePlotSeparatePlot", "barPlotHorizontalAxis", "barPlotSeparatePlots",
  "rainCloudHorizontalAxis", "rainCloudSeparatePlots"
)

jb_simplify_opt <- function(x) {
  if (is.null(x)) return(NULL)
  if (is.list(x)) {
    if (!is.null(names(x))) return(lapply(x, jb_simplify_opt))
    atomic <- vapply(x, function(el) is.atomic(el) && length(el) == 1, logical(1))
    if (length(atomic) > 0 && all(atomic)) return(unlist(x, use.names = FALSE))
    return(lapply(x, jb_simplify_opt))
  }
  x
}

jb_to_json <- function(value) {
  jsonlite::toJSON(
    value,
    auto_unbox = TRUE,
    null = "null",
    na = "null",
    dataframe = "rows"
  )
}

jb_load_runtime <- function(runtime) {
  if (!nzchar(runtime) || !dir.exists(runtime)) {
    stop(sprintf("JASP runtime not found: %s. Run scripts/setup_runtime.ps1 first.", runtime))
  }
  lib <- file.path(runtime, "lib")
  base <- file.path(runtime, "R", "library")
  if (!dir.exists(lib) || !dir.exists(base)) {
    stop(sprintf("Runtime is incomplete: %s", runtime))
  }
  .libPaths(c(lib, base))
  if (!requireNamespace("jaspTools", quietly = TRUE)) {
    stop("jaspTools is not available in the runtime.")
  }
  suppressPackageStartupMessages(library(jaspTools))
  invisible(TRUE)
}

jb_collect_tables <- function(results) {
  tables <- list()
  walk <- function(node, path = character()) {
    if (is.list(node) && !is.null(node$data) && is.list(node$data) && !is.null(node$schema)) {
      key <- if (length(path) > 0) paste(path, collapse = "/") else "table"
      tables[[key]] <<- list(
        title = if (is.null(node$title)) key else node$title,
        data = lapply(node$data, function(row) as.list(row)),
        schema = node$schema
      )
      return(invisible(NULL))
    }
    if (is.list(node)) {
      for (name in names(node)) walk(node[[name]], c(path, name))
    }
    invisible(NULL)
  }
  walk(results)
  tables
}

# JASP tables use the encoded column names (jaspColumn1, ...). Decode them back
# so result.json, Markdown, CSV and the written .jasp keep the user's names.
# Do not treat jaspColumn2 as a prefix of jaspColumn21 (object ids).
# Escape regex metacharacters without a character class. Windows R uses TRE
# by default, and TRE treats ']' inside '[...{}...]' as the end of the class,
# then errors with "Invalid contents of {}". fixed=TRUE avoids that engine.
jb_escape_regex <- function(x) {
  specials <- c("\\", ".", "^", "$", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|")
  vapply(as.character(x), function(s) {
    for (ch in specials) {
      s <- gsub(ch, paste0("\\", ch), s, fixed = TRUE)
    }
    s
  }, character(1), USE.NAMES = FALSE)
}

jb_decode_map <- function(encodingMap) {
  if (is.null(encodingMap)) return(NULL)
  if (is.data.frame(encodingMap)) {
    if (nrow(encodingMap) == 0) return(NULL)
    order <- order(nchar(as.character(encodingMap$encoded)), decreasing = TRUE)
    return(list(
      originals = as.character(encodingMap$original[order]),
      encoded = as.character(encodingMap$encoded[order])
    ))
  }
  NULL
}

jb_decode_string <- function(value, originals, encoded) {
  if (!is.character(value)) return(value)
  for (i in seq_along(encoded)) {
    pattern <- paste0("(?<![A-Za-z0-9])", jb_escape_regex(encoded[i]), "(?![0-9])")
    value <- gsub(pattern, originals[i], value, perl = TRUE)
  }
  value
}

jb_decode_tree <- function(value, encodingMap) {
  map <- jb_decode_map(encodingMap)
  if (is.null(map)) return(value)
  walk <- function(node) {
    if (is.character(node)) return(jb_decode_string(node, map$originals, map$encoded))
    if (is.list(node)) {
      node <- lapply(node, walk)
      if (!is.null(names(node))) {
        names(node) <- jb_decode_string(names(node), map$originals, map$encoded)
      }
      return(node)
    }
    node
  }
  walk(value)
}

jb_decode_value <- function(value, originals, encoded) {
  jb_decode_string(value, originals, encoded)
}

jb_decode_tables <- function(tables, encodingMap) {
  if (is.null(jb_decode_map(encodingMap))) return(tables)
  for (key in names(tables)) {
    tables[[key]] <- jb_decode_tree(tables[[key]], encodingMap)
  }
  if (!is.null(names(tables))) {
    names(tables) <- jb_decode_tree(names(tables), encodingMap)
  }
  tables
}

# R >= 4.5 made stats::var() on factors defunct, which breaks jaspBase's
# variance check for categorical columns (mixed models run it on every column).
# Patch jaspBase in-place so the check only looks at continuous columns.
jb_patch_variance_check <- function() {
  tryCatch({
    ns <- asNamespace("jaspBase")
    if (!exists(".checkVariance", envir = ns, inherits = FALSE)) return(invisible(FALSE))
    original <- get(".checkVariance", envir = ns)
    patched <- function(dataset, target, equalTo = 0, grouping = NULL, groupingLevel = NULL) {
      target <- intersect(target, names(dataset))
      continuous <- target[vapply(target, function(v) !is.factor(dataset[[v]]), logical(1))]
      if (length(continuous) == 0) return(list(error = FALSE, errorVars = NULL))
      original(dataset, continuous, equalTo, grouping, groupingLevel)
    }
    unlockBinding(".checkVariance", ns)
    assign(".checkVariance", patched, envir = ns)
    lockBinding(".checkVariance", ns)
    invisible(TRUE)
  }, error = function(e) invisible(FALSE))
}

jb_output_location <- function() {
  tryCatch(
    get("getTempOutputLocation", asNamespace("jaspTools"))(),
    error = function(e) file.path(tempdir(), "jaspTools")
  )
}

jb_analysis_id <- function() {
  0L
}

# Point jaspBase at the official resources/N paths so finishJaspResults()
# writes the internal jaspResults.json (otherwise saveResults() is a no-op).
jb_prepare_jasp_results_dir <- function(outputDir, analysisId = 0L) {
  dest <- file.path(outputDir, "resources", as.character(analysisId))
  dir.create(dest, recursive = TRUE, showWarnings = FALSE)
  if (!requireNamespace("jaspBase", quietly = TRUE)) return(FALSE)
  root <- normalizePath(outputDir, winslash = "/", mustWork = TRUE)
  rel <- sprintf("resources/%s/jaspResults.json", analysisId)
  seal <- sprintf("resources/%s/jaspResultsFinishedWriting.txt", analysisId)
  tryCatch({
    jaspBase:::setSaveLocation(root, rel)
    jaspBase:::setWriteSealLocation(root, seal)
    TRUE
  }, error = function(e) FALSE)
}

# Copy collected plots next to jaspResults and rewrite viewer JSON paths
# so the .jasp archive can pack them under resources/N/.
jb_stage_plot_resources <- function(results, plots, outputDir, analysisId = 0L) {
  if (length(plots) == 0) return(results)
  destDir <- file.path(outputDir, "resources", as.character(analysisId))
  dir.create(destDir, recursive = TRUE, showWarnings = FALSE)
  rewrite <- function(node) {
    if (!is.list(node)) return(node)
    dataValue <- node$data
    if (
      is.character(dataValue) &&
      length(dataValue) == 1 &&
      grepl("\\.(png|svg|jpe?g)$", dataValue, ignore.case = TRUE)
    ) {
      src <- NULL
      for (plot in plots) {
        if (identical(plot$source, dataValue) || (
          !is.null(plot$file) && identical(basename(plot$file), basename(dataValue))
        )) {
          src <- plot$file
          break
        }
      }
      if (!is.null(src) && file.exists(src)) {
        fname <- basename(dataValue)
        invisible(file.copy(src, file.path(destDir, fname), overwrite = TRUE))
        node$data <- sprintf("resources/%s/%s", analysisId, fname)
      }
    }
    nms <- names(node)
    if (length(nms) > 0) {
      for (nm in nms) node[[nm]] <- rewrite(node[[nm]])
    }
    node
  }
  rewrite(results)
}


jb_collect_plots <- function(results, outputDir) {
  plots <- list()
  seen <- character()
  baseDir <- file.path(jb_output_location(), "html")
  plotDir <- file.path(outputDir, "plots")
  dir.create(plotDir, recursive = TRUE, showWarnings = FALSE)

  walk <- function(node, path = character()) {
    if (is.list(node)) {
      dataValue <- node$data
      if (
        is.character(dataValue) &&
        length(dataValue) == 1 &&
        grepl("\\.(png|svg|jpe?g)$", dataValue, ignore.case = TRUE)
      ) {
        sourceFile <- file.path(baseDir, dataValue)
        if (file.exists(sourceFile) && !(sourceFile %in% seen)) {
          seen <<- c(seen, sourceFile)
          key <- if (length(path) > 0) paste(path, collapse = "/") else paste0("plot_", length(plots) + 1)
          title <- if (is.null(node$title)) key else as.character(node$title)[1]
          extension <- tolower(tools::file_ext(sourceFile))
          mime <- if (extension == "svg") {
            "image/svg+xml"
          } else if (extension %in% c("jpg", "jpeg")) {
            "image/jpeg"
          } else {
            "image/png"
          }
          safe <- gsub("[^A-Za-z0-9._-]+", "_", key)
          destination <- file.path(
            plotDir,
            sprintf("%02d_%s.%s", length(plots) + 1, substr(safe, 1, 60), extension)
          )
          if (file.copy(sourceFile, destination, overwrite = TRUE)) {
            plots[[length(plots) + 1]] <<- list(
              title = title,
              source = dataValue,
              file = destination,
              mime = mime
            )
          }
        }
      }
      if (length(names(node)) > 0) {
        for (name in names(node)) walk(node[[name]], c(path, name))
      }
    }
    invisible(NULL)
  }

  walk(results)
  plots
}

jb_run_analysis <- function(request, runtime) {
  name <- request$name
  if (is.null(name) || !nzchar(name)) stop("Request is missing the analysis name.")
  entry <- jb_module_map[[name]]
  if (is.null(entry)) {
    stop(sprintf(
      "Analysis %s is not supported by P0. Supported: %s",
      name,
      paste(names(jb_module_map), collapse = ", ")
    ))
  }

  module_bundle <- file.path(runtime, "Modules", "module_libs", entry$bundle)
  module_dir <- file.path(module_bundle, entry$pkg)
  if (!dir.exists(module_dir)) {
    stop(sprintf("JASP module not found: %s. Re-run scripts/setup_runtime.ps1.", module_dir))
  }

  .libPaths(c(module_bundle, file.path(runtime, "lib"), file.path(runtime, "R", "library")))
  jaspTools::setPkgOption("module.dirs", module_dir)

  # The mixed-models module calls lme4 internals (e.g. forceNewMerMod) without
  # the lme4:: prefix, so the package has to be attached, not just loaded.
  if (name %in% c("MixedModelsLMM", "MixedModelsGLMM")) {
    try(suppressPackageStartupMessages(library(lme4)), silent = TRUE)
  }
  if (name %in% c("MixedModelsBLMM", "MixedModelsBGLMM")) {
    try(suppressPackageStartupMessages(library(rstanarm)), silent = TRUE)
  }
  if (name == "BayesianProcess") {
    try(suppressPackageStartupMessages(library(blavaan)), silent = TRUE)
  }

  dataset <- utils::read.csv(
    request$data_path,
    check.names = FALSE,
    stringsAsFactors = FALSE,
    na.strings = c("", "NA"),
    fileEncoding = "UTF-8"
  )
  # JASP's data model treats categorical columns as factors.
  for (column in names(dataset)) {
    if (is.character(dataset[[column]])) dataset[[column]] <- factor(dataset[[column]])
  }

  jb_patch_variance_check()

  options <- jaspTools::analysisOptions(name)
  for (key in names(request$options)) {
    options[[key]] <- jb_simplify_opt(request$options[[key]])
  }

  wrapper <- tryCatch(get(name, asNamespace(entry$pkg)), error = function(e) NULL)
  if (is.null(wrapper) || !is.function(wrapper)) {
    stop(sprintf("Analysis function %s not found in module %s.", name, entry$pkg))
  }

  defaults <- lapply(formals(wrapper), function(x) {
    tryCatch(eval(x, envir = environment(wrapper)), error = function(e) NULL)
  })
  defaults[c("data", "version", "formula")] <- NULL

  force_null <- if (name == "Anova") {
    jb_anova_force_null
  } else if (name == "Ancova") {
    setdiff(jb_anova_force_null, "covariates")
  } else if (name == "AnovaRepeatedMeasures") {
    jb_rm_force_null
  } else {
    character(0)
  }

  # Opt-in features: keep the caller's values instead of nulling them.
  simple_keys <- c(
    "simpleMainEffectFactor", "simpleMainEffectModeratorFactorOne",
    "simpleMainEffectModeratorFactorTwo", "simpleMainEffects",
    "simpleEffectSizeEstimates", "simpleEffectSizePartialEtaSquared",
    "simpleEffectSizePartialOmegaSquared", "simpleEffectSizeCi",
    "simpleEffectSizeCiLevel"
  )
  contrast_keys <- c(
    "contrasts", "customContrasts", "contrastCi", "contrastCiLevel",
    "contrastEffectSize", "poolErrorTermFollowup"
  )
  requested_simple <- request$options$simpleMainEffectFactor
  has_simple_effects <- !is.null(requested_simple) && nzchar(as.character(requested_simple))
  if (has_simple_effects) {
    force_null <- setdiff(force_null, simple_keys)
  }
  if (length(request$options$contrasts) > 0) {
    force_null <- setdiff(force_null, contrast_keys)
  }
  # Structured defaults (collection with an "optionKey", or a variable option
  # shaped like list(types=, value=)) are not valid option values in a headless
  # request: copying them makes JASP build a bogus term (e.g. a factor named
  # "variable") or compare a list to a string. Only plain defaults are copied.
  is_collection_default <- function(value) {
    if (!is.list(value) || is.null(names(value))) return(FALSE)
    hasOptionKey <- "optionKey" %in% names(value)
    isVariableOption <- all(c("types", "value") %in% names(value))
    hasOptionKey || isVariableOption
  }
  fill <- setdiff(names(defaults), c(names(options), force_null))
  if (length(fill) > 0) {
    is_collection <- vapply(defaults[fill], is_collection_default, logical(1))
    fill <- fill[!is_collection]
  }
  for (key in fill) options[[key]] <- defaults[[key]]

  if (name %in% c("Anova", "Ancova")) {
    for (key in force_null) options[[key]] <- NULL
    if (!has_simple_effects) {
      options$simpleMainEffectFactor <- ""
      options$simpleMainEffectModeratorFactorOne <- ""
      options$simpleMainEffectModeratorFactorTwo <- ""
      options$simpleMainEffects <- FALSE
    }
  } else if (name == "AnovaRepeatedMeasures") {
    for (key in force_null) options[[key]] <- NULL
    if (!has_simple_effects) {
      options$simpleMainEffectFactor <- ""
      options$simpleMainEffectModeratorFactorOne <- ""
      options$simpleMainEffectModeratorFactorTwo <- ""
    }
  }

  seed <- if (!is.null(request$seed)) as.integer(request$seed) else 1L
  set.seed(seed)

  outputDir <- if (!is.null(request$output_dir)) request$output_dir else tempdir()
  dir.create(outputDir, recursive = TRUE, showWarnings = FALSE)
  analysisId <- if (!is.null(request$analysis_id)) as.integer(request$analysis_id) else jb_analysis_id()
  jb_prepare_jasp_results_dir(outputDir, analysisId)

  encoded <- jaspTools::encodeOptionsAndDataset(options, dataset)
  encodingMap <- if (!is.null(encoded$encodingMap) && is.data.frame(encoded$encodingMap)) {
    encoded$encodingMap
  } else {
    data.frame(original = character(), encoded = character(), stringsAsFactors = FALSE)
  }
  if (nrow(encodingMap) > 0) {
    result <- jaspTools::runAnalysis(
      name,
      encoded$dataset,
      encoded$options,
      view = FALSE,
      encodedDataset = TRUE
    )
  } else {
    result <- jaspTools::runAnalysis(name, dataset, options, view = FALSE)
  }

  tables <- jb_collect_tables(result$results)
  tables <- jb_decode_tables(tables, encodingMap)
  plots <- jb_collect_plots(result$results, outputDir)
  viewer_results <- jb_stage_plot_resources(result$results, plots, outputDir, analysisId)
  viewer_results <- jb_decode_tree(viewer_results, encodingMap)
  if (length(plots) > 0) {
    for (i in seq_along(plots)) {
      plots[[i]]$title <- jb_decode_tree(plots[[i]]$title, encodingMap)
    }
  }

  status <- if (identical(result$status, "complete")) {
    "ok"
  } else if (length(tables) > 0) {
    "partial"
  } else {
    "error"
  }

  payload <- list(
    status = status,
    jasp_status = result$status,
    analysis = name,
    module = entry$pkg,
    seed = seed,
    tables = tables,
    plots = plots,
    encoding_map = encodingMap,
    versions = list(
      R = R.version.string,
      jaspTools = as.character(utils::packageVersion("jaspTools")),
      runtime = runtime
    )
  )

  if (!is.null(result$results$errorMessage)) {
    payload$error_message <- result$results$errorMessage
  }

  # Viewer JSON (analyses.json "results") plus the official internal
  # jaspResults object written by jaspBase::saveResults() when the save
  # location was set above.
  payload$jasp_results_json <- tryCatch(
    jb_to_json(viewer_results),
    error = function(e) tryCatch(jb_to_json(result$results), error = function(e2) NULL)
  )
  internalPath <- file.path(outputDir, "resources", as.character(analysisId), "jaspResults.json")
  if (file.exists(internalPath)) {
    # Rewrite the official object in place as text so formatting stays intact.
    tryCatch({
      raw <- rawToChar(readBin(internalPath, what = "raw", n = file.info(internalPath)$size))
      map <- jb_decode_map(encodingMap)
      if (!is.null(map)) {
        raw <- jb_decode_string(raw, map$originals, map$encoded)
        con <- file(internalPath, "wb")
        writeBin(charToRaw(raw), con)
        close(con)
      }
    }, error = function(e) invisible(NULL))
    payload$jasp_internal_path <- file.path("resources", as.character(analysisId), "jaspResults.json")
    payload$jasp_internal_json <- tryCatch({
      size <- file.info(internalPath)$size
      rawToChar(readBin(internalPath, what = "raw", n = size))
    }, error = function(e) NULL)
  }
  if (status == "error") {
    payload$message <- if (is.null(result$results$errorMessage)) {
      "JASP did not return results."
    } else {
      result$results$errorMessage
    }
  }

  payload
}
