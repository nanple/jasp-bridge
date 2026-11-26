# Read Excel (.xlsx/.xls) or SPSS (.sav) via readxl / haven when the JASP R
# runtime is available. Writes a single JSON file and exits 0 even on handled
# errors so the Node caller can inspect the payload.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 3) {
  stop("usage: read_tabular.R <input> <output_json> <xlsx|xls|sav> [sheet]")
}

input <- args[[1]]
output <- args[[2]]
fmt <- args[[3]]
sheet_arg <- if (length(args) >= 4) args[[4]] else ""

runtime <- Sys.getenv("JASP_RUNTIME", unset = "")
if (nzchar(runtime)) {
  .libPaths(c(
    file.path(runtime, "lib"),
    file.path(runtime, "R", "library"),
    file.path(runtime, "Modules", "module_libs"),
    .libPaths()
  ))
}

`%||%` <- function(x, y) if (is.null(x) || (length(x) == 1 && is.na(x))) y else x

write_payload <- function(payload) {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    raw <- paste0('{"ok":false,"code":"missing_package","message":"未找到 R 包 jsonlite。"}')
    writeLines(raw, output, useBytes = TRUE)
    return(invisible(NULL))
  }
  jsonlite::write_json(
    payload,
    output,
    auto_unbox = TRUE,
    null = "null",
    na = "null",
    pretty = FALSE,
    digits = NA
  )
}

fail <- function(code, message, extra = list()) {
  write_payload(c(list(ok = FALSE, code = code, message = message), extra))
  quit(save = "no", status = 0)
}

need <- if (fmt %in% c("xlsx", "xls", "xlsm")) "readxl" else "haven"
if (!requireNamespace(need, quietly = TRUE)) {
  fail("missing_package", paste0("未找到 R 包 ", need, "。"))
}

is_user_error <- function(message) {
  grepl("password|encrypt|encrypted|sheet does not exist|cannot find|does not exist|invalid sheet", message, ignore.case = TRUE)
}

measure_type <- function(x) {
  measure <- attr(x, "measure")
  if (!is.null(measure)) {
    key <- tolower(as.character(measure)[[1]])
    if (key %in% c("nominal", "ordinal", "scale")) return(key)
  }
  if (is.character(x) || is.factor(x)) return("nominal")
  NULL
}

value_labels_of <- function(x) {
  labs <- attr(x, "labels")
  if (is.null(labs) || length(labs) == 0) return(NULL)
  codes <- as.character(unname(labs))
  labels <- names(labs)
  if (is.null(labels)) labels <- codes
  out <- as.list(labels)
  names(out) <- codes
  out
}

column_label <- function(x, name) {
  label <- attr(x, "label")
  if (is.null(label) || !nzchar(as.character(label)[[1]])) name else as.character(label)[[1]]
}

as_plain <- function(x) {
  if (requireNamespace("haven", quietly = TRUE)) {
    x <- tryCatch(haven::zap_labels(x), error = function(e) x)
    x <- tryCatch(haven::zap_empty(x), error = function(e) x)
  }
  if (inherits(x, "Date") || inherits(x, "POSIXt") || inherits(x, "hms")) {
    return(as.character(x))
  }
  if (is.factor(x)) return(as.character(x))
  if (is.logical(x)) return(x)
  if (is.numeric(x)) return(x)
  if (is.character(x)) {
    trimmed <- sub("[[:space:]]+$", "", x)
    trimmed[trimmed == ""] <- NA_character_
    return(trimmed)
  }
  as.character(x)
}

build_result <- function(df, extra) {
  meta <- lapply(names(df), function(nm) {
    x <- df[[nm]]
    item <- list(name = nm, label = column_label(x, nm))
    typ <- measure_type(x)
    if (!is.null(typ)) item$type <- typ
    labs <- value_labels_of(x)
    if (!is.null(labs)) item$valueLabels <- labs
    item
  })
  names(meta) <- names(df)
  plain <- as.data.frame(lapply(df, as_plain), stringsAsFactors = FALSE, check.names = FALSE)
  records <- jsonlite::fromJSON(
    jsonlite::toJSON(plain, dataframe = "rows", na = "null", null = "null", auto_unbox = TRUE, digits = NA),
    simplifyVector = FALSE
  )
  c(
    list(ok = TRUE, records = records, columnMeta = meta),
    extra
  )
}

tryCatch({
  if (fmt %in% c("xlsx", "xls", "xlsm")) {
    sheets <- tryCatch(readxl::excel_sheets(input), error = function(error) {
      message <- conditionMessage(error)
      if (grepl("password|encrypt", message, ignore.case = TRUE)) {
        fail("encrypted", "该 Excel 工作簿已加密或受密码保护，无法读取。请先在 Excel 中取消密码后再加载。")
      }
      fail("parse_error", message)
    })
    if (length(sheets) == 0) fail("no_sheets", "工作簿中没有任何工作表。")

    selected_name <- sheets[[1]]
    selected_index <- 1L
    if (nzchar(sheet_arg)) {
      if (grepl("^-?[0-9]+$", sheet_arg)) {
        n <- as.integer(sheet_arg)
        if (is.na(n) || n < 1) {
          fail("sheet_not_found", paste0("工作表序号从 1 开始，收到的是 ", sheet_arg, "。"), list(sheets = sheets))
        }
        if (n > length(sheets)) {
          fail("sheet_not_found", paste0("工作簿没有第 ", n, " 张表。"), list(sheets = sheets))
        }
        selected_index <- n
        selected_name <- sheets[[n]]
      } else {
        idx <- match(sheet_arg, sheets)
        if (is.na(idx)) {
          fail("sheet_not_found", paste0("找不到名为「", sheet_arg, "」的工作表。"), list(sheets = sheets))
        }
        selected_index <- as.integer(idx)
        selected_name <- sheets[[idx]]
      }
    }

    df <- tryCatch(
      readxl::read_excel(input, sheet = selected_name, .name_repair = "unique"),
      error = function(error) {
        message <- conditionMessage(error)
        if (grepl("password|encrypt", message, ignore.case = TRUE)) {
          fail("encrypted", "该 Excel 工作簿已加密或受密码保护，无法读取。请先在 Excel 中取消密码后再加载。")
        }
        fail("parse_error", message)
      }
    )
    if (nrow(df) == 0) {
      fail(
        "empty",
        paste0("工作表「", selected_name, "」没有数据行（至少需要 1 行记录）。"),
        list(sheets = as.character(sheets), sheet = selected_name)
      )
    }
    write_payload(build_result(df, list(
      engine = "readxl",
      sheet = selected_name,
      sheetIndex = selected_index,
      sheets = as.character(sheets)
    )))
  } else {
    df <- tryCatch(haven::read_sav(input, user_na = TRUE), error = function(error) {
      fail("parse_error", conditionMessage(error))
    })
    if (nrow(df) == 0) {
      fail("empty", "该 .sav 文件没有数据行（至少需要 1 行记录）。")
    }
    if (requireNamespace("haven", quietly = TRUE)) {
      df <- tryCatch(haven::zap_missing(df), error = function(e) df)
    }
    write_payload(build_result(df, list(engine = "haven")))
  }
}, error = function(error) {
  message <- conditionMessage(error)
  if (is_user_error(message)) {
    fail("parse_error", message)
  }
  fail("parse_error", message)
})
