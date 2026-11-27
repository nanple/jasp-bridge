function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

const POSTHOC_HINT = /事后|两两|多重比较|post\s*-?\s*hoc|tukey|bonferroni|holm|scheff|sidak|lsd|fdr|benjamini/i;

function levelCount(session, name) {
  const variable = (session?.data?.variables || []).find(
    (item) => String(item.name).toLowerCase() === String(name).toLowerCase()
  );
  if (!variable) return 0;
  if (Array.isArray(variable.levels)) return variable.levels.length;
  if (typeof variable.unique === "number") return variable.unique;
  return 0;
}

function wantsPostHoc(utterance) {
  return POSTHOC_HINT.test(String(utterance || ""));
}

function pickCorrection(utterance) {
  const text = String(utterance || "").toLowerCase();
  if (/tukey|图基/.test(text)) return "tukey";
  if (/bonferroni|邦弗/.test(text)) return "bonferroni";
  if (/scheff|雪费/.test(text)) return "scheffe";
  if (/sidak|šidák/.test(text)) return "sidak";
  if (/fdr|benjamini/.test(text)) return "fdr";
  if (/holm/.test(text)) return "holm";
  return null;
}

function correctionFlags(correction, options = {}) {
  return {
    postHocCorrectionHolm: correction === "holm",
    postHocCorrectionBonferroni: correction === "bonferroni",
    postHocCorrectionTukey: correction === "tukey",
    postHocCorrectionScheffe: correction === "scheffe",
    postHocCorrectionSidak: correction === "sidak",
    ...(options.fdr ? { postHocCorrectionFdr: correction === "fdr" } : {}),
  };
}

function inferWithinFactorName(utterance, cells) {
  const text = String(utterance || "").toLowerCase();
  if (/时间|时点|前测|后测|追踪|随访|time|wave|month|week|day/.test(text)) return "时间";
  if (/条件|情境|处理|刺激|实验条件|condition|treatment/.test(text)) return "条件";
  if (cells.some((name) => /^(pre|post|t\d|time)/i.test(name))) return "时间";
  return "测量";
}

const CONTRAST_HINTS = [
  [/helmert|赫尔默特/i, "Helmert"],
  [/多项式|polynomial|趋势(对比|检验)/i, "polynomial"],
  [/重复对比|repeated\s*contrast/i, "repeated"],
  [/差异对比|difference\s*contrast/i, "difference"],
  [/偏差对比|deviation\s*contrast/i, "deviation"],
  [/简单对比|simple\s*contrast/i, "simple"],
];

export function detectContrast(utterance) {
  const text = String(utterance || "");
  for (const [pattern, type] of CONTRAST_HINTS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function simpleEffectOptions(factor, moderator, moderatorTwo) {
  return {
    simpleMainEffectFactor: factor,
    "simpleMainEffectFactor.types": "nominal",
    simpleMainEffectModeratorFactorOne: moderator,
    "simpleMainEffectModeratorFactorOne.types": "nominal",
    simpleMainEffectModeratorFactorTwo: moderatorTwo || "",
    simpleEffectSizeEstimates: true,
    simpleEffectSizePartialEtaSquared: true,
    simpleEffectSizeCi: true,
    simpleEffectSizeCiLevel: 0.95,
  };
}

// JASP wants main effects plus every interaction term of the given factors.
function buildModelTerms(factors) {
  const terms = factors.map((factor) => ({ components: [factor] }));
  for (let size = 2; size <= factors.length; size += 1) {
    const walk = (start, picked) => {
      if (picked.length === size) {
        terms.push({ components: picked });
        return;
      }
      for (let i = start; i < factors.length; i += 1) {
        walk(i + 1, [...picked, factors[i]]);
      }
    };
    walk(0, []);
  }
  return terms;
}

// 重复测量的简单效应有两个方向：被试内因子在各组间水平上（默认），
// 或组间因子在各时间点上。用话里出现顺序判断。
function detectRmSimpleDirection(utterance, betweenNames, withinName) {
  const text = String(utterance || "");
  let factor = withinName;
  let moderator = betweenNames[0];
  if (betweenNames.length === 0) return { factor, moderator };

  // “各时间点上的性别差异” → 组间因子在各时间点上比较
  if (/各\s*(个)?\s*(时间点|时点|测量点)|每个时间点|时间点上的|各时点上/.test(text)) {
    return { factor: betweenNames[0], moderator: withinName };
  }

  const timeMatch = /时间|时点|每次|每轮|wave|time/i.exec(text);
  if (timeMatch) {
    const factorIndex = text.indexOf(betweenNames[0]);
    if (factorIndex > timeMatch.index) {
      factor = betweenNames[0];
      moderator = withinName;
    }
  }
  return { factor, moderator };
}

function contrastOptions(variable, contrast) {
  return {
    contrasts: [{ variable, contrast }],
    contrastCi: true,
    contrastCiLevel: 0.95,
    contrastEffectSize: true,
  };
}

function typeOf(session, name) {
  const variable = (session?.data?.variables || []).find(
    (item) => String(item.name).toLowerCase() === String(name).toLowerCase()
  );
  return variable?.type || "scale";
}

const PROCESS_MODELS = [1, 4, 6, 7, 8, 14, 15];

export function resolveProcessModel(variables = {}, utterance = "") {
  const text = String(utterance || "");
  const explicit = /(?:模型|model|process)\s*([0-9]{1,2})/i.exec(text);
  if (explicit) return Number(explicit[1]);

  const mediators = variables.mediators || [];
  const hasModerator = Boolean(first(variables.moderatorW) || first(variables.moderatorZ));
  const laterStage = /后段|第二阶段|b\s*路径|间接路径|后半段/.test(text);

  if (mediators.length >= 2) return hasModerator ? (laterStage ? 15 : 14) : 6;
  if (mediators.length === 1) return hasModerator ? (laterStage ? 8 : 7) : 4;
  if (hasModerator) return 1;
  return null;
}

export function isSupportedProcessModel(modelNumber) {
  return PROCESS_MODELS.includes(Number(modelNumber));
}

const GLMM_FAMILY_LINKS = {
  bernoulli: "logit",
  binomial: "logit",
  gaussian: "identity",
  gamma: "log",
  inverseGaussian: "log",
  poisson: "log",
  negativeBinomial: "log",
  beta: "logit",
};

export function resolveGlmmFamily(utterance = "") {
  const text = String(utterance || "");
  if (/负二项|negative\s*binomial/i.test(text)) return "negativeBinomial";
  if (/(汇总|试验次数|aggregated).{0,8}(二项|binomial)|(二项|binomial).{0,8}(汇总|试验次数|aggregated)/i.test(text)) {
    return "binomial";
  }
  if (/二项|逻辑斯蒂|logistic|bernoulli|binomial/i.test(text)) return "bernoulli";
  if (/计数|泊松|poisson/i.test(text)) return "poisson";
  if (/伽马|gamma/i.test(text)) return "gamma";
  if (/逆高斯|inverse\s*gaussian/i.test(text)) return "inverseGaussian";
  if (/贝塔|beta\s*(分布|回归|族|family)/i.test(text)) return "beta";
  return "gaussian";
}

function glmmLinkFor(family) {
  return GLMM_FAMILY_LINKS[family] || "identity";
}


function buildProcessOptions(vars, context = {}, { bayesian = false } = {}) {
  const session = context.session;
  const utterance = context.utterance || "";
  const modelNumber = resolveProcessModel(vars, utterance) || 4;
  const dependent = first(vars.dependent);
  const independent = first(vars.independent);
  const mediators = vars.mediators || [];
  const moderatorW = first(vars.moderatorW) || "";
  const moderatorZ = first(vars.moderatorZ) || "";
  const extras = vars.covariates || [];
  const predictors = [
    ...new Set(
      [independent, ...mediators, moderatorW, moderatorZ, ...extras].filter(Boolean)
    ),
  ];
  const factors = predictors.filter((name) => typeOf(session, name) === "nominal");
  const covariates = predictors.filter((name) => typeOf(session, name) !== "nominal");
  const isMediation = [4, 6, 7, 8, 14, 15].includes(modelNumber);
  const isModeratedMediation = [7, 8, 14, 15].includes(modelNumber);
  const useFiml = /fiml|缺失值|缺失数据|全信息最大似然/i.test(utterance);

  const options = {
    dependent,
    "dependent.types": typeOf(session, dependent),
    covariates,
    "covariates.types": covariates.map((name) => typeOf(session, name)),
    factors,
    "factors.types": factors.map((name) => typeOf(session, name)),
    processModels: [
      {
        name: `Model ${modelNumber}`,
        inputType: "inputModelNumber",
        // Required by JASP's nested dependency checker even in model-number mode.
        processRelationships: [],
        modelNumber,
        modelNumberIndependent: independent,
        modelNumberMediators: mediators,
        modelNumberModeratorW: moderatorW,
        modelNumberModeratorZ: moderatorZ,
        pathCoefficients: true,
        mediationEffects: isMediation,
        totalEffects: true,
        intercepts: false,
        residualCovariances: false,
        independentCovariances: true,
        mediatorCovariances: false,
        dependentCovariances: false,
        localTests: false,
        conceptualPathPlot: true,
        statisticalPathPlot: false,
      },
    ],
    moderationProbes: [
      { probePercentile: 16 },
      { probePercentile: 50 },
      { probePercentile: 84 },
    ],
    ciLevel: 0.95,
    meanCenteredModeration: true,
    useColorPalette: true,
    colorPalette: "colorblind",
    pathPlotsLabelLength: 3,
    pathPlotsLegendLabels: true,
    pathPlotsLegendColor: false,
    statisticalPathPlotsCovariances: false,
    statisticalPathPlotsResidualVariances: false,
    statisticalPathPlotsParameterEstimates: false,
    parameterLabels: false,
    syntax: false,
    independentCovariancesForAllModels: true,
    mediatorCovariancesForAllModels: false,
    dependentCovariancesForAllModels: false,
  };

  if (bayesian) {
    return {
      ...options,
      mcmcBurnin: 500,
      mcmcSamples: 1000,
      mcmcChains: 3,
      setSeed: true,
      seed: 1,
      betaPriorMu: "0",
      betaPriorSigma: "10",
      nuPriorMu: "0",
      nuPriorSigma: "32",
      psiPriorAlpha: "1.0",
      psiPriorBeta: "0.5",
      rhoPriorAlpha: "1",
      rhoPriorBeta: "1",
      conceptualPathPlotsForAllModels: true,
      interceptsForAllModels: false,
      mediationEffectsForAllModels: true,
      pathCoefficientsForAllModels: true,
      statisticalPathPlotsForAllModels: false,
      totalEffectsForAllModels: true,
      residualCovariancesForAllModels: false,
      priorDistributions: false,
      bicWeights: false,
      hayesNumber: false,
      aggregatedChains: true,
      legend: true,
      densityPlot: false,
      histogramPlot: false,
      tracePlot: false,
      autoCorPlot: false,
      autoCorPlotLags: 20,
      autoCorPlotType: "lines",
      bivariateScatterPlot: false,
      bivariateScatterDiagonalType: "density",
      bivariateScatterOffDiagonalType: "hexagon",
    };
  }

  return {
    ...options,
    ...(isModeratedMediation ? { moderatedMediationIndex: true } : {}),
    errorCalculationMethod: isMediation ? "bootstrap" : "standard",
    ...(isMediation
      ? {
          bootstrapSamples: 1000,
          bootstrapCiType: "percentileBiasCorrected",
        }
      : {}),
    naAction: useFiml ? "fiml" : "listwise",
    emulation: "lavaan",
    estimator: "default",
    standardizedModelEstimates: false,
    rSquared: true,
    localTests: false,
    residualCovariancesForAllModels: false,
  };
}


function pickFactorMethod(utterance) {
  const text = String(utterance || "").toLowerCase();
  if (/最大似然|maximum likelihood|(^|[^a-z])ml([^a-z]|$)/.test(text)) return "maximumLikelihood";
  if (/主轴|principal axis|(^|[^a-z])pa([^a-z]|$)/.test(text)) return "principalAxis";
  if (/普通最小二乘|ordinary least squares/.test(text)) return "ordinaryLeastSquares";
  if (/加权最小二乘|weighted least squares/.test(text)) return "weightedLeastSquares";
  return "minimumResidual";
}

function pickRotation(utterance) {
  const text = String(utterance || "").toLowerCase();
  if (/正交|orthogonal|varimax|quartimax|maximin|equamax|bentlert/.test(text)) return "orthogonal";
  return "oblique";
}

function pickOblique(utterance) {
  const text = String(utterance || "").toLowerCase();
  if (/oblimin/.test(text)) return "oblimin";
  if (/simplimax/.test(text)) return "simplimax";
  if (/geomin/.test(text)) return "geominQ";
  if (/bentler/.test(text)) return "bentlerQ";
  if (/biquartimin/.test(text)) return "biquartimin";
  return "promax";
}

function pickOrthogonal(utterance) {
  const text = String(utterance || "").toLowerCase();
  if (/quartimax/.test(text)) return "quartimax";
  if (/bentler/.test(text)) return "bentlerT";
  if (/equamax/.test(text)) return "equamax";
  if (/geomin/.test(text)) return "geominT";
  return "varimax";
}

function pickFactorCount(utterance, n) {
  const match = /(\d+)\s*(个|种|维度|factors?|components?|维度数)/i.exec(String(utterance || ""));
  if (match) return Math.max(1, Math.min(Number(match[1]), n));
  return Math.min(n, Math.max(2, Math.round(Math.sqrt(n))));
}

// 描述统计里 Shapiro-Wilk / 矩阵散点图开始提醒的变量数阈值。
// 官方 JASP 这两项默认关闭。矩阵散点图会生成 p(p-1)/2 张成对散点图：
// 15 个变量即 105 张图；一次放入约 40 道题时可能需要数分钟。
// 心理量表单个分量表也常见不超过 15 题，因此以 15 作为提醒阈值。
export const DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD = 15;

const SHAPIRO_WILK_HINT = /shapiro|夏皮罗|正态性|正态检验|正态分布检验|normality\s*test/i;
const MATRIX_PLOT_HINT = /matrix\s*-?plot|矩阵散点|散点图矩阵|矩阵图|散点图/i;

export function wantsShapiroWilk(utterance) {
  return SHAPIRO_WILK_HINT.test(String(utterance || ""));
}

export function wantsMatrixPlot(utterance) {
  return MATRIX_PLOT_HINT.test(String(utterance || ""));
}

export function descriptivesVariableCount(options = {}, variables = {}) {
  const fromOptions = options.variables;
  if (Array.isArray(fromOptions) && fromOptions.length > 0) return fromOptions.length;
  const fromRoles = variables.variables;
  if (Array.isArray(fromRoles) && fromRoles.length > 0) return fromRoles.length;
  return 0;
}

export function descriptivesHeavyOptionWarnings(options = {}, context = {}) {
  const count = descriptivesVariableCount(options, context.variables);
  if (count < DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD) return [];
  const warnings = [];
  const threshold = DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD;
  if (options.shapiroWilkTest) {
    warnings.push(
      `已按你的要求打开 Shapiro-Wilk 正态检验，但当前分析有 ${count} 个变量（达到或超过 ${threshold} 个时可能明显变慢）。如需加快，可关掉 shapiroWilkTest，或按分量表分开跑。`
    );
  }
  if (options.matrixPlot) {
    warnings.push(
      `已按你的要求打开矩阵散点图（matrixPlot），但当前分析有 ${count} 个变量（达到或超过 ${threshold} 个时，成对散点图数量会按变量数平方增长，可能需要数分钟）。不会取消你的明确要求；如需加快，可关掉 matrixPlot，或减少一次分析的变量数。`
    );
  }
  return warnings;
}

export const RECIPES = {
  descriptives: {
    key: "descriptives",
    label: "描述统计",
    jasp: { analysis: "Descriptives", module: "jaspDescriptives" },
    keywords: ["描述统计", "描述性", "均值", "标准差", "分布", "概况", "样本特征", "descriptive"],
    roles: {
      variables: { required: true, min: 1, kinds: ["scale", "ordinal"], label: "分析变量" },
      splitBy: { required: false, max: 1, kinds: ["nominal"], label: "分组变量" },
    },
    buildOptions(vars, context = {}) {
      const utterance = context.utterance || "";
      return {
        variables: vars.variables,
        ...(vars.splitBy ? { splitBy: first(vars.splitBy) } : {}),
        valid: true,
        missing: true,
        meanArithmetic: true,
        sd: true,
        minimum: true,
        maximum: true,
        median: true,
        quartiles: true,
        skewness: true,
        kurtosis: true,
        // 与官方 JASP 一致：这两项默认关闭。题项较多时（尤其是矩阵散点图）会明显变慢。
        // 用户在选项里显式打开，或在对话中明确要求正态检验 / 矩阵散点图时，仍然打开。
        shapiroWilkTest: wantsShapiroWilk(utterance),
        matrixPlot: wantsMatrixPlot(utterance),
      };
    },
    optionWarnings(options, context) {
      return descriptivesHeavyOptionWarnings(options, context);
    },
    apaHint: "报告 M、SD、偏度与样本量；若做参数检验，可再打开 Shapiro-Wilk 看正态性。",
  },

  reliability: {
    key: "reliability",
    label: "信度分析",
    jasp: { analysis: "reliabilityUnidimensionalFrequentist", module: "jaspReliability" },
    keywords: ["信度", "内部一致性", "cronbach", "alpha", "α系数", "克隆巴赫", "reliability"],
    roles: {
      variables: { required: true, min: 2, kinds: ["scale", "ordinal"], label: "量表题项" },
      reverseScaledItems: { required: false, kinds: ["scale", "ordinal"], label: "反向计分题项" },
    },
    buildOptions(vars) {
      return {
        variables: vars.variables,
        ...(vars.reverseScaledItems
          ? { reverseScaledItems: vars.reverseScaledItems }
          : {}),
        scaleAlpha: true,
        scaleOmega: true,
        itemDeletedAlpha: true,
        itemRestCorrelation: true,
        itemMean: true,
        itemSd: true,
        naAction: "listwise",
      };
    },
    apaHint: "报告 Cronbach's α（必要时 McDonald's ω）与删除条目后的 α 变化。",
  },

  correlation: {
    key: "correlation",
    label: "相关分析",
    jasp: { analysis: "Correlation", module: "jaspRegression" },
    keywords: ["相关", "correlation", "pearson", "spearman", "kendall", "皮尔逊", "斯皮尔曼"],
    roles: {
      variables: { required: true, min: 2, kinds: ["scale", "ordinal"], label: "相关变量" },
      partialOutVariables: { required: false, kinds: ["scale", "ordinal"], label: "控制变量" },
    },
    buildOptions(vars, context = {}) {
      const utterance = String(context.utterance || "").toLowerCase();
      const useSpearman = /spearman|斯皮尔曼/.test(utterance);
      const useKendall = /kendall|肯德尔/.test(utterance);
      return {
        variables: vars.variables,
        ...(vars.partialOutVariables
          ? { partialOutVariables: vars.partialOutVariables }
          : {}),
        pearson: !useSpearman && !useKendall,
        ...(useSpearman ? { spearman: true } : {}),
        ...(useKendall ? { kendallsTauB: true } : {}),
        significanceReport: true,
        sampleSize: true,
        pairwiseDisplay: false,
        naAction: "pairwise",
      };
    },
    apaHint: "报告 r、p、样本量；多个变量时注意多重比较与共线性。",
  },

  ttest_independent: {
    key: "ttest_independent",
    label: "独立样本 t 检验",
    jasp: { analysis: "TTestIndependentSamples", module: "jaspTTests" },
    keywords: ["t检验", "t 检验", "独立样本", "两组差异", "男女差异", "性别差异", "均值差异"],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量" },
      group: { required: true, max: 1, kinds: ["nominal"], label: "分组变量" },
    },
    buildOptions(vars) {
      return {
        dependent: first(vars.dependent),
        group: first(vars.group),
        student: true,
        welch: true,
        descriptives: true,
        effectSize: true,
        effectSizeType: "cohen",
        normalityTest: true,
        equalityOfVariancesTest: true,
        meanDifference: true,
        meanDifferenceCi: true,
        barPlot: false,
        rainCloudPlot: false,
        naAction: "perDependent",
      };
    },
    apaHint: "先看 Levene 检验；方差不齐时报告 Welch t。同时报告 Cohen's d。",
  },

  paired_ttest: {
    key: "paired_ttest",
    label: "配对样本 t 检验",
    jasp: { analysis: "TTestPairedSamples", module: "jaspTTests" },
    keywords: ["配对t", "配对 t", "配对样本", "前后测", "paired"],
    roles: {
      pairs: { required: true, min: 2, max: 2, kinds: ["scale", "ordinal"], label: "配对变量" },
    },
    buildOptions(vars) {
      return {
        pairs: [vars.pairs],
        student: true,
        wilcoxon: false,
        descriptives: true,
        effectSize: true,
        meanDifference: true,
        meanDifferenceCi: true,
        normalityTest: true,
        barPlot: false,
        rainCloudPlot: false,
        differenceRaincloudPlot: false,
        naAction: "perDependent",
      };
    },
    apaHint: "报告差值均值、t、p 和 Cohen's dz；同时看差值正态性。",
    beta: true,
  },

  ancova: {
    key: "ancova",
    label: "协方差分析 ANCOVA",
    jasp: { analysis: "Ancova", module: "jaspAnova" },
    keywords: ["协方差", "ancova", "控制变量", "协变量"],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量" },
      fixedFactors: { required: true, min: 1, max: 2, kinds: ["nominal"], label: "固定因子" },
      covariates: { required: true, min: 1, kinds: ["scale", "ordinal"], label: "协变量" },
    },
    buildOptions(vars) {
      const terms = [...vars.fixedFactors, ...vars.covariates];
      return {
        dependent: first(vars.dependent),
        fixedFactors: vars.fixedFactors,
        covariates: vars.covariates,
        modelTerms: [{ components: terms }],
        descriptives: true,
        effectSizeEstimates: true,
        effectSizePartialEtaSquared: true,
        homogeneityTests: true,
        factorCovariateIndependenceCheck: true,
        barPlot: false,
        rainCloudPlot: false,
        naAction: "listwise",
      };
    },
    apaHint: "报告调整后均值、F、p、偏 eta²，并说明协变量与因子是否独立。",
    beta: true,
  },

  anova: {
    key: "anova",
    label: "单因素方差分析",
    jasp: { analysis: "Anova", module: "jaspAnova" },
    keywords: ["方差分析", "anova", "多组", "三组", "事后比较", "tukey", "简单效应"],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量" },
      fixedFactors: { required: true, min: 1, max: 3, kinds: ["nominal"], label: "固定因子" },
      simpleEffectFactor: {
        required: false,
        max: 1,
        kinds: ["nominal"],
        label: "简单效应因子",
      },
      simpleEffectModerator: {
        required: false,
        max: 1,
        kinds: ["nominal"],
        label: "简单效应调节因子",
      },
      simpleEffectModeratorTwo: {
        required: false,
        max: 1,
        kinds: ["nominal"],
        label: "简单效应第二个调节因子",
      },
    },
    buildOptions(vars, context = {}) {
      const factors = vars.fixedFactors || [];
      const utterance = context.utterance || "";
      const multiLevel = factors.some((factor) => levelCount(context.session, factor) > 2);
      const postHoc = factors.length > 0 && (wantsPostHoc(utterance) || multiLevel);
      const correction = pickCorrection(utterance) || "tukey";
      const simpleFactor = first(vars.simpleEffectFactor);
      const simpleModerator = first(vars.simpleEffectModerator);
      const simpleModeratorTwo = first(vars.simpleEffectModeratorTwo);
      const contrast = detectContrast(utterance);
      return {
        dependent: first(vars.dependent),
        fixedFactors: factors,
        modelTerms: buildModelTerms(factors),
        descriptives: true,
        homogeneityTests: true,
        effectSizeEstimates: true,
        effectSizeEtaSquared: true,
        ...(simpleFactor && simpleModerator
          ? simpleEffectOptions(simpleFactor, simpleModerator, simpleModeratorTwo)
          : {}),
        ...(contrast
          ? {
              contrasts: factors.map((factor) => ({ variable: factor, contrast })),
              contrastCi: true,
              contrastCiLevel: 0.95,
              contrastEffectSize: true,
            }
          : {}),
        ...(postHoc
          ? {
              postHocTerms: factors.map((factor) => ({ components: [factor] })),
              postHocTypeStandard: true,
              postHocTypeStandardEffectSize: true,
              postHocCi: true,
              ...correctionFlags(correction),
            }
          : {}),
        barPlot: false,
        rainCloudPlot: false,
        vovkSellke: false,
      };
    },
    beta: true,
    apaHint:
      "报告 F、df、p、η²/偏 eta² 与 Levene；显著时报告事后比较（默认 Tukey，可指定 Holm/Bonferroni/Scheffé/Šidák）。",
  },

  rm_anova: {
    key: "rm_anova",
    label: "重复测量方差分析",
    jasp: { analysis: "AnovaRepeatedMeasures", module: "jaspAnova" },
    keywords: [
      "重复测量",
      "重复测量方差分析",
      "被试内",
      "within-subject",
      "within subject",
      "rm anova",
      "纵向追踪",
      "多时点",
    ],
    roles: {
      repeatedMeasuresCells: {
        required: true,
        min: 2,
        kinds: ["scale", "ordinal"],
        label: "重复测量变量（按水平顺序）",
      },
      betweenSubjectFactors: {
        required: false,
        max: 2,
        kinds: ["nominal"],
        label: "组间因子",
      },
    },
    buildOptions(vars, context = {}) {
      const cells = vars.repeatedMeasuresCells || [];
      const between = vars.betweenSubjectFactors || [];
      const utterance = context.utterance || "";
      const factorName = inferWithinFactorName(utterance, cells);
      const postHoc = cells.length >= 3 || wantsPostHoc(utterance);
      const correction = pickCorrection(utterance) || "holm";
      const simple = /简单效应/.test(utterance) && between.length > 0;
      const direction = simple
        ? detectRmSimpleDirection(utterance, between, factorName)
        : null;
      const contrast = detectContrast(utterance);
      const options = {
        repeatedMeasuresCells: cells,
        repeatedMeasuresFactors: [{ name: factorName, levels: cells }],
        withinModelTerms: [{ components: [factorName] }],
        descriptives: true,
        effectSizeEstimates: true,
        effectSizePartialEtaSquared: true,
        ...(cells.length > 2
          ? {
              sphericityTests: true,
              sphericityCorrectionGreenhouseGeisser: true,
            }
          : {}),
        ...(between.length > 0
          ? {
              betweenSubjectFactors: between,
              betweenModelTerms: [{ components: between }],
              homogeneityTests: true,
            }
          : {}),
        ...(postHoc
          ? {
              postHocTerms: [factorName, ...between].map((factor) => ({
                components: [factor],
              })),
              postHocEffectSize: true,
              postHocCi: true,
              ...correctionFlags(correction, { fdr: true }),
            }
          : {}),
        ...(simple
          ? simpleEffectOptions(
              direction.factor,
              direction.moderator,
              direction.moderator === factorName ? between[1] : undefined
            )
          : {}),
        ...(contrast ? contrastOptions(factorName, contrast) : {}),
        barPlot: false,
        rainCloudPlot: false,
      };
      return options;
    },
    apaHint:
      "先看 Mauchly 球形检验；违反时报告 Greenhouse-Geisser 校正后的 F、df、p 与偏 eta²。事后比较默认 Holm 校正，报告均值差、t、校正 p 与 Cohen's d。",
  },

  process: {
    key: "process",
    label: "Process 中介/调节",
    jasp: { analysis: "ClassicProcess", module: "jaspProcess" },
    keywords: [
      "中介",
      "调节",
      "中介效应",
      "调节效应",
      "有调节的中介",
      "process",
      "hayes",
      "bootstrap",
      "条件间接效应",
      "链式中介",
    ],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量 Y" },
      independent: {
        required: true,
        max: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "自变量 X",
      },
      mediators: {
        required: false,
        max: 2,
        kinds: ["scale", "ordinal"],
        label: "中介变量 M（按链式顺序）",
      },
      moderatorW: {
        required: false,
        max: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "调节变量 W",
      },
      moderatorZ: {
        required: false,
        max: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "调节变量 Z",
      },
      covariates: {
        required: false,
        kinds: ["scale", "ordinal", "nominal"],
        label: "协变量",
      },
    },
    buildOptions(vars, context = {}) {
      return buildProcessOptions(vars, context, { bayesian: false });
    },
    apaHint:
      "中介：报告 a、b、c′ 路径，间接效应点估计与 bootstrap 95% CI（不含 0 即显著）；调节：报告交互项、简单斜率与 Johnson-Neyman 区间。",
  },

  mixed_glmm: {
    key: "mixed_glmm",
    label: "广义线性混合模型",
    jasp: { analysis: "MixedModelsGLMM", module: "jaspMixedModels" },
    keywords: [
      "广义线性混合模型",
      "glmm",
      "二项混合模型",
      "logistic混合",
      "计数混合模型",
      "poisson混合",
    ],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale", "ordinal"], label: "因变量" },
      fixedEffects: {
        required: true,
        min: 1,
        max: 3,
        kinds: ["scale", "ordinal", "nominal"],
        label: "固定效应变量",
      },
      randomFactors: { required: true, min: 1, max: 1, kinds: ["nominal"], label: "随机效应分组" },
      covariates: { required: false, kinds: ["scale", "ordinal", "nominal"], label: "协变量" },
    },
    buildOptions(vars, context = {}) {
      const session = context.session;
      const utterance = context.utterance || "";
      const dependent = first(vars.dependent);
      const fixed = vars.fixedEffects || [];
      const group = first(vars.randomFactors);
      const extras = vars.covariates || [];
      const family = resolveGlmmFamily(utterance);
      const link = glmmLinkFor(family);

      return {
        dependent,
        "dependent.types": typeOf(session, dependent),
        family,
        link,
        fixedVariables: fixed,
        "fixedVariables.types": fixed.map((name) => typeOf(session, name)),
        fixedEffects: fixed.map((name) => ({ components: [name] })),
        randomVariables: [group],
        "randomVariables.types": [typeOf(session, group)],
        randomEffects: [
          {
            value: group,
            correlations: false,
            randomComponents: [{ value: ["Intercept"], randomSlopes: true }],
          },
        ],
        includeIntercept: true,
        modelSummary: true,
        fixedEffectEstimate: true,
        randomEffectEstimate: true,
        ...(extras.length > 0 ? { covariates: extras } : {}),
        plotBackgroundData: [],
        plotHorizontalAxis: [],
        plotSeparateLines: [],
        plotSeparatePlots: [],
        plotTheme: "jasp",
        plotLegendPosition: "none",
        plotCiLevel: 0.95,
        plotCiType: "model",
        factorContrast: "sum",
      };
    },
    apaHint:
      "报告固定效应的 β/SE/z/p、随机效应方差与模型拟合；二项模型报告 OR（exp(β)）。",
  },

  plssem: {
    key: "plssem",
    label: "偏最小二乘结构方程（PLS-SEM）",
    jasp: { analysis: "PLSSEM", module: "jaspSem" },
    keywords: ["pls-sem", "plssem", "偏最小二乘", "pls结构方程", "composite", "合成测量"],
    roles: {},
    buildOptions() {
      return {
        group: "",
        consistentPartialLeastSquares: true,
        innerWeightingScheme: "smart",
        errorCalculationMethod: "bootstrap",
        bootstrapSamples: 1000,
        ciLevel: 0.95,
        rSquared: true,
        additionalFitMeasures: true,
        reliabilityMeasures: true,
        models: [],
      };
    },
    validateOptions(options) {
      const models = options.models;
      if (!Array.isArray(models) || models.length === 0) {
        return [
          "PLS-SEM 需要模型设定：在 options.models 里传 [{name, syntax}]，syntax 用 PLS 复合测量语法，例如 \"F1 -> x1 + x2 + x3\\nF2 -> x4 + x5\\nperf ~ F1 + F2\"。",
        ];
      }
      return [];
    },
    normalizeOptions(options) {
      if (!Array.isArray(options.models)) return options;
      const models = options.models.map((model, index) => {
        const name = model?.name || `Model ${index + 1}`;
        const syntax = model?.syntax;
        if (typeof syntax === "string") {
          return {
            name,
            syntax: { columns: [], model: syntax, modelOriginal: syntax },
          };
        }
        return { name, ...model };
      });
      return { ...options, models };
    },
    apaHint:
      "PLS-SEM 报告路径系数、bootstrapped CI、Composite Reliability、AVE 与 HTMT；小样本慎用。",
  },

  regression: {
    key: "regression",
    label: "多元线性回归",
    jasp: { analysis: "RegressionLinear", module: "jaspRegression" },
    keywords: ["回归", "预测", "影响因素", "解释力", "r方", "r²", "共线性", "vif", "regression"],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量" },
      covariates: { required: true, min: 1, kinds: ["scale", "ordinal"], label: "预测变量" },
      factors: { required: false, kinds: ["nominal"], label: "分类预测变量" },
    },
    buildOptions(vars) {
      const terms = [...vars.covariates, ...(vars.factors || [])];
      return {
        dependent: first(vars.dependent),
        covariates: vars.covariates,
        ...(vars.factors ? { factors: vars.factors } : {}),
        modelTerms: terms.length > 0 ? [{ components: terms }] : [],
        method: "enter",
        modelFit: true,
        coefficientEstimate: true,
        coefficientCi: true,
        collinearityStatistic: true,
        descriptives: true,
        residualCasewiseDiagnostic: false,
        naAction: "listwise",
      };
    },
    beta: true,
    apaHint: "报告 R²、F、β、p、VIF；VIF>10 需讨论共线性。",
  },

  efa: {
    key: "efa",
    label: "探索性因子分析",
    jasp: { analysis: "exploratoryFactorAnalysis", module: "jaspFactor" },
    keywords: ["探索性因子", "因子分析", "efa", "因素分析", "共同因子", "题项聚合"],
    roles: {
      variables: {
        required: true,
        min: 3,
        kinds: ["scale", "ordinal"],
        label: "观测变量（题项）",
      },
    },
    buildOptions(vars, context = {}) {
      const variables = vars.variables || [];
      const utterance = context.utterance || "";
      const rotation = pickRotation(utterance);
      return {
        variables,
        "variables.types": variables.map((name) => typeOf(context.session, name)),
        factoringMethod: pickFactorMethod(utterance),
        rotationMethod: rotation,
        ...(rotation === "oblique"
          ? { obliqueSelector: pickOblique(utterance) }
          : { orthogonalSelector: pickOrthogonal(utterance) }),
        factorCountMethod: "manual",
        manualNumberOfFactors: pickFactorCount(utterance, variables.length),
        eigenvaluesAbove: 1,
        parallelAnalysisMethod: "principalComponentBased",
        baseDecompositionOn: "correlationMatrix",
        screePlot: true,
        factorCorrelations: rotation === "oblique",
        fitIndices: true,
        kaiserMeyerOlkinTest: true,
        bartlettTest: true,
        antiImageCorrelationMatrix: false,
        residualMatrix: false,
        orderLoadingsBy: "size",
        loadingsDisplayLimit: 0.4,
        setSeed: true,
        seed: 1,
        naAction: "pairwise",
      };
    },
    apaHint:
      "报告 KMO、Bartlett 球形检验、累计解释方差、因子载荷（≥0.4 视为有意义）与因子间相关；并说明因子数如何确定。",
  },

  pca: {
    key: "pca",
    label: "主成分分析",
    jasp: { analysis: "principalComponentAnalysis", module: "jaspFactor" },
    keywords: ["主成分", "pca", "主成分分析", "降维"],
    roles: {
      variables: {
        required: true,
        min: 3,
        kinds: ["scale", "ordinal"],
        label: "观测变量",
      },
    },
    buildOptions(vars, context = {}) {
      const variables = vars.variables || [];
      const utterance = context.utterance || "";
      return {
        variables,
        "variables.types": variables.map((name) => typeOf(context.session, name)),
        componentCountMethod: "manual",
        manualNumberOfComponents: pickFactorCount(utterance, variables.length),
        eigenvaluesAbove: 1,
        parallelAnalysisMethod: "principalComponentBased",
        baseDecompositionOn: "correlationMatrix",
        screePlot: true,
        componentCorrelations: false,
        fitIndices: true,
        kaiserMeyerOlkinTest: true,
        bartlettTest: true,
        antiImageCorrelationMatrix: false,
        residualMatrix: false,
        orderLoadingsBy: "size",
        loadingsDisplayLimit: 0.4,
        setSeed: true,
        seed: 1,
        naAction: "pairwise",
      };
    },
    apaHint:
      "报告累计解释方差、碎石图与成分载荷；说明保留成分数的依据（特征值 > 1、平行分析或累积方差 ≥ 60%）。",
  },

  cfa: {
    key: "cfa",
    label: "验证性因子分析",
    jasp: { analysis: "confirmatoryFactorAnalysis", module: "jaspFactor" },
    keywords: ["验证性因子", "cfa", "验证性因子分析", "confirmatory"],
    roles: {
      variables: {
        required: false,
        min: 3,
        kinds: ["scale", "ordinal"],
        label: "观测变量（题项，可选；通常写在 factors 里）",
      },
    },
    buildOptions(vars) {
      return {
        group: "",
        samplingWeights: "",
        fitMeasures: true,
        reliability: true,
        rSquared: true,
        pathPlot: true,
        modificationIndices: false,
        htmt: false,
        ave: false,
        kaiserMeyerOlkinTest: true,
        bartlettTest: true,
        impliedCovarianceMatrix: false,
        residualCovarianceMatrix: false,
        ciLevel: 0.95,
        estimator: "default",
        naAction: "fiml",
        latentInterceptsFixedToZero: true,
        residualSingleIndicatorOmitted: true,
        residualVariances: true,
        dependentVariablesCorrelated: true,
        exogenousLatentsCorrelated: true,
        secondOrder: [],
        standardized: "none",
        pathPlotVariance: true,
        pathPlotParameter: true,
      };
    },
    validateOptions(options, context = {}) {
      const questions = [];
      const factors = options.factors;
      if (!Array.isArray(factors) || factors.length === 0) {
        questions.push(
          "CFA 需要先给出因子结构：在 options.factors 里传 [{name, title, indicators}]，indicators 为该因子的题项。"
        );
        return questions;
      }
      const known = new Set(
        (context.session?.data?.variables || []).map((variable) => variable.name)
      );
      for (const factor of factors) {
        const indicators = factor?.indicators || [];
        if (indicators.length < 2) {
          questions.push(`因子「${factor?.name || "?"}」至少需要 2 个指标变量。`);
        }
        for (const indicator of indicators) {
          if (known.size > 0 && !known.has(indicator)) {
            questions.push(`因子「${factor?.name || "?"}」的指标「${indicator}」不在当前数据集中。`);
          }
        }
      }
      if (factors.length < 2) {
        questions.push("CFA 至少需要 2 个潜变量（因子）。");
      }
      return questions;
    },
    apaHint:
      "报告 χ²/df、CFI、TLI、RMSEA、SRMR、因子载荷与组合信度（CR/α）；拟合不佳时说明修正依据。",
  },

  sem: {
    key: "sem",
    label: "结构方程模型",
    jasp: { analysis: "SEM", module: "jaspSem" },
    keywords: ["结构方程", "sem", "路径模型", "潜变量", "协方差结构"],
    roles: {},
    buildOptions() {
      return {
        group: "",
        samplingWeights: "",
        additionalFitMeasures: true,
        modificationIndex: false,
        rSquared: true,
        reliability: false,
        pathPlot: true,
        standardizedEstimate: false,
        observedCovariance: false,
        impliedCovariance: false,
        residualCovariance: false,
        residualVariance: true,
        meanStructure: false,
        naAction: "fiml",
        estimator: "default",
        emulation: "lavaan",
        errorCalculationMethod: "default",
        ciLevel: 0.95,
        setSeed: true,
        seed: 1,
        models: [],
      };
    },
    validateOptions(options) {
      const models = options.models;
      if (!Array.isArray(models) || models.length === 0) {
        return [
          "SEM 需要模型设定：在 options.models 里传 [{name, syntax}]，syntax 用 lavaan 语法，例如 \"F1 =~ x1 + x2 + x3\\nF2 =~ x4 + x5\"。",
        ];
      }
      const questions = [];
      for (const model of models) {
        if (!model?.syntax) questions.push(`模型「${model?.name || "?"}」缺少 syntax（lavaan 语法）。`);
      }
      return questions;
    },
    normalizeOptions(options) {
      // JASP expects the lavaan syntax as a small table ({columns, model,
      // modelOriginal}); accept the plain string form and convert it.
      if (!Array.isArray(options.models)) return options;
      const models = options.models.map((model, index) => {
        const name = model?.name || `Model ${index + 1}`;
        const syntax = model?.syntax;
        if (typeof syntax === "string") {
          return {
            name,
            syntax: { columns: [], model: syntax, modelOriginal: syntax },
          };
        }
        return { name, ...model };
      });
      return { ...options, models };
    },
    apaHint:
      "报告 χ²/df、CFI、TLI、RMSEA、SRMR、路径系数与 R²；说明测量模型与结构模型分别的拟合。",
  },

  mixed_lmm: {
    key: "mixed_lmm",
    label: "线性混合模型",
    jasp: { analysis: "MixedModelsLMM", module: "jaspMixedModels" },
    keywords: [
      "混合模型",
      "随机效应",
      "随机截距",
      "随机斜率",
      "mixed model",
      "lmm",
      "多水平",
    ],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量" },
      fixedEffects: {
        required: true,
        min: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "固定效应变量",
      },
      randomFactors: {
        required: true,
        max: 1,
        kinds: ["nominal"],
        label: "随机分组因子（如被试 ID）",
      },
    },
    buildOptions(vars, context = {}) {
      const utterance = context.utterance || "";
      const dependent = first(vars.dependent);
      const fixed = vars.fixedEffects || [];
      const group = first(vars.randomFactors);
      const randomSlopes = /随机斜率|random slope/i.test(utterance);
      return {
        dependent,
        "dependent.types": typeOf(context.session, dependent),
        fixedVariables: fixed,
        "fixedVariables.types": fixed.map((name) => typeOf(context.session, name)),
        fixedEffects: fixed.map((name) => ({ components: [name] })),
        randomVariables: [group],
        "randomVariables.types": [typeOf(context.session, group)],
        randomEffects: [
          {
            value: group,
            correlations: true,
            randomComponents: [
              { value: ["Intercept"], randomSlopes: true },
              ...(randomSlopes
                ? fixed.map((name) => ({ value: [name], randomSlopes: true }))
                : []),
            ],
          },
        ],
        includeIntercept: true,
        fixedEffectEstimate: true,
        randomEffectEstimate: true,
        modelSummary: true,
        interceptTest: false,
        marginalMeansComparison: false,
        plotBackgroundData: [],
        plotHorizontalAxis: [],
        plotSeparateLines: [],
        plotSeparatePlots: [],
        plotTheme: "jasp",
        plotLegendPosition: "none",
        plotCiLevel: 0.95,
        plotCiType: "model",
        factorContrast: "sum",
      };
    },
    apaHint:
      "报告固定效应估计与 CI、随机效应方差（组间/组内）、ICC；说明随机截距与随机斜率结构如何确定。",
  },

  process_bayesian: {
    key: "process_bayesian",
    label: "贝叶斯 Process 中介/调节",
    jasp: { analysis: "BayesianProcess", module: "jaspProcess" },
    keywords: [
      "贝叶斯中介",
      "贝叶斯调节",
      "bayesian process",
      "bayesian mediation",
      "bayesian moderation",
      "mcmc中介",
    ],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量 Y" },
      independent: {
        required: true,
        max: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "自变量 X",
      },
      mediators: {
        required: false,
        max: 2,
        kinds: ["scale", "ordinal"],
        label: "中介变量 M（按链式顺序）",
      },
      moderatorW: {
        required: false,
        max: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "调节变量 W",
      },
      moderatorZ: {
        required: false,
        max: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "调节变量 Z",
      },
      covariates: {
        required: false,
        kinds: ["scale", "ordinal", "nominal"],
        label: "协变量",
      },
    },
    buildOptions(vars, context = {}) {
      return buildProcessOptions(vars, context, { bayesian: true });
    },
    apaHint:
      "贝叶斯中介/调节：报告后验均值、可信区间与路径图；间接效应以可信区间是否包含 0 判断。MCMC 默认 3 条链、500 次 burn-in、1000 次抽样。",
  },

  mixed_blmm: {
    key: "mixed_blmm",
    label: "贝叶斯线性混合模型",
    jasp: { analysis: "MixedModelsBLMM", module: "jaspMixedModels" },
    keywords: [
      "贝叶斯混合模型",
      "贝叶斯线性混合",
      "blmm",
      "bayesian mixed",
      "bayesian linear mixed",
    ],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale"], label: "因变量" },
      fixedEffects: {
        required: true,
        min: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "固定效应变量",
      },
      randomFactors: {
        required: true,
        max: 1,
        kinds: ["nominal"],
        label: "随机分组因子（如被试 ID）",
      },
    },
    buildOptions(vars, context = {}) {
      const utterance = context.utterance || "";
      const dependent = first(vars.dependent);
      const fixed = vars.fixedEffects || [];
      const group = first(vars.randomFactors);
      const randomSlopes = /随机斜率|random slope/i.test(utterance);
      return {
        dependent,
        "dependent.types": typeOf(context.session, dependent),
        fixedVariables: fixed,
        "fixedVariables.types": fixed.map((name) => typeOf(context.session, name)),
        fixedEffects: fixed.map((name) => ({ components: [name] })),
        randomVariables: [group],
        "randomVariables.types": [typeOf(context.session, group)],
        randomEffects: [
          {
            value: group,
            correlations: true,
            randomComponents: [
              { value: ["Intercept"], randomSlopes: true },
              ...(randomSlopes
                ? fixed.map((name) => ({ value: [name], randomSlopes: true }))
                : []),
            ],
          },
        ],
        includeIntercept: true,
        estimateType: "deviation",
        modelSummary: true,
        fixedEffectEstimate: true,
        varianceCorrelationEstimate: true,
        randomEffectEstimate: true,
        mcmcBurnin: 500,
        mcmcSamples: 1000,
        mcmcChains: 3,
        mcmcAdaptDelta: 0.8,
        mcmcMaxTreedepth: 10,
        ciLevel: 0.95,
        setSeed: true,
        seed: 1,
        plotBackgroundData: [],
        plotHorizontalAxis: [],
        plotSeparateLines: [],
        plotSeparatePlots: [],
        plotTheme: "jasp",
        plotLegendPosition: "none",
        plotCiLevel: 0.95,
        plotCiType: "model",
      };
    },
    apaHint:
      "报告固定效应后验估计与可信区间、随机效应方差/相关、模型拟合；说明 MCMC 链数、burn-in 与抽样次数，并检查收敛（R̂、有效样本量）。",
  },

  mixed_bglmm: {
    key: "mixed_bglmm",
    label: "贝叶斯广义线性混合模型",
    jasp: { analysis: "MixedModelsBGLMM", module: "jaspMixedModels" },
    keywords: [
      "贝叶斯广义线性混合",
      "贝叶斯广义混合",
      "bglmm",
      "bayesian glmm",
      "bayesian generalized mixed",
      "贝叶斯二项混合",
      "贝叶斯泊松混合",
    ],
    roles: {
      dependent: { required: true, max: 1, kinds: ["scale", "ordinal", "nominal"], label: "因变量" },
      fixedEffects: {
        required: true,
        min: 1,
        max: 3,
        kinds: ["scale", "ordinal", "nominal"],
        label: "固定效应变量",
      },
      randomFactors: { required: true, min: 1, max: 1, kinds: ["nominal"], label: "随机效应分组" },
      covariates: { required: false, kinds: ["scale", "ordinal", "nominal"], label: "协变量" },
    },
    buildOptions(vars, context = {}) {
      const session = context.session;
      const utterance = context.utterance || "";
      const dependent = first(vars.dependent);
      const fixed = vars.fixedEffects || [];
      const group = first(vars.randomFactors);
      const extras = vars.covariates || [];
      const family = resolveGlmmFamily(utterance);
      const link = glmmLinkFor(family);
      const randomSlopes = /随机斜率|random slope/i.test(utterance);
      return {
        dependent,
        "dependent.types": typeOf(session, dependent),
        family,
        link,
        fixedVariables: fixed,
        "fixedVariables.types": fixed.map((name) => typeOf(session, name)),
        fixedEffects: fixed.map((name) => ({ components: [name] })),
        randomVariables: [group],
        "randomVariables.types": [typeOf(session, group)],
        randomEffects: [
          {
            value: group,
            correlations: true,
            randomComponents: [
              { value: ["Intercept"], randomSlopes: true },
              ...(randomSlopes
                ? fixed.map((name) => ({ value: [name], randomSlopes: true }))
                : []),
            ],
          },
        ],
        includeIntercept: true,
        estimateType: "deviation",
        modelSummary: true,
        fixedEffectEstimate: true,
        varianceCorrelationEstimate: true,
        randomEffectEstimate: true,
        mcmcBurnin: 500,
        mcmcSamples: 1000,
        mcmcChains: 3,
        mcmcAdaptDelta: 0.8,
        mcmcMaxTreedepth: 10,
        ciLevel: 0.95,
        setSeed: true,
        seed: 1,
        ...(extras.length > 0 ? { covariates: extras } : {}),
        plotBackgroundData: [],
        plotHorizontalAxis: [],
        plotSeparateLines: [],
        plotSeparatePlots: [],
        plotTheme: "jasp",
        plotLegendPosition: "none",
        plotCiLevel: 0.95,
        plotCiType: "model",
      };
    },
    apaHint:
      "报告固定效应后验估计与可信区间、随机效应方差、所选分布族与连接函数；二项模型可报告 OR（exp(β)）。说明 MCMC 设置并检查 R̂ 与有效样本量。",
  },

  mimic: {
    key: "mimic",
    label: "MIMIC 模型",
    jasp: { analysis: "MIMIC", module: "jaspSem" },
    keywords: ["mimic", "多重指标多重原因", "mimic模型", "mimic model"],
    roles: {
      indicators: {
        required: true,
        min: 3,
        kinds: ["scale", "ordinal"],
        label: "指标变量（定义潜变量）",
      },
      predictors: {
        required: true,
        min: 1,
        kinds: ["scale", "ordinal", "nominal"],
        label: "原因/预测变量（连续或二分）",
      },
    },
    buildOptions(vars, context = {}) {
      const session = context.session;
      const indicators = vars.indicators || [];
      const predictors = vars.predictors || [];
      return {
        indicators,
        "indicators.types": indicators.map((name) => typeOf(session, name)),
        predictors,
        "predictors.types": predictors.map((name) => typeOf(session, name)),
        includePredictorCovariances: predictors.length > 1,
        fixPredictorVariancesAndCovariances: false,
        additionalFitMeasures: true,
        rSquared: true,
        standardizedEstimate: false,
        standardizedEstimateType: "all",
        syntax: false,
        pathPlot: true,
        pathPlotParameter: true,
        pathPlotLegend: false,
        naAction: "fiml",
        estimator: "default",
        emulation: "lavaan",
        errorCalculationMethod: "standard",
        ciLevel: 0.95,
      };
    },
    validateOptions(options, context = {}) {
      const questions = [];
      const session = context.session;
      for (const name of options.predictors || []) {
        const variable = (session?.data?.variables || []).find(
          (item) => String(item.name).toLowerCase() === String(name).toLowerCase()
        );
        if (!variable) continue;
        const levels = Array.isArray(variable.levels) ? variable.levels.length : variable.unique;
        if (variable.type === "nominal" && Number(levels) > 2) {
          questions.push(
            `MIMIC 的预测变量必须是连续或二分变量，「${name}」有 ${levels} 个水平，请改用连续变量或二分变量。`
          );
        }
      }
      return questions;
    },
    apaHint:
      "报告潜变量的测量载荷、预测变量到潜变量的路径、χ²/df、CFI、TLI、RMSEA、SRMR 与 R²；预测变量只允许连续或二分。",
  },

  latent_growth: {
    key: "latent_growth",
    label: "潜变量增长曲线",
    jasp: { analysis: "LatentGrowthCurve", module: "jaspSem" },
    keywords: [
      "潜变量增长",
      "潜增长曲线",
      "潜增长模型",
      "latent growth",
      "lgcm",
      "增长曲线模型",
    ],
    roles: {
      variables: {
        required: true,
        min: 3,
        kinds: ["scale"],
        label: "重复测量变量（按时间顺序）",
      },
      regressions: {
        required: false,
        kinds: ["scale"],
        label: "预测增长因子的连续协变量",
      },
      categorical: {
        required: false,
        kinds: ["nominal"],
        label: "预测增长因子的分类变量",
      },
    },
    buildOptions(vars, context = {}) {
      const session = context.session;
      const utterance = context.utterance || "";
      const variables = vars.variables || [];
      const regressions = vars.regressions || [];
      const categorical = vars.categorical || [];
      const cubic = /三次|cubic/i.test(utterance);
      const quadratic = cubic || /二次|quadratic/i.test(utterance);
      const timings = variables.map((name, index) => ({ variable: name, timing: index }));
      return {
        variables,
        "variables.types": variables.map((name) => typeOf(session, name)),
        timings,
        regressions,
        "regressions.types": regressions.map((name) => typeOf(session, name)),
        categorical,
        "categorical.types": categorical.map((name) => typeOf(session, name)),
        intercept: true,
        linear: true,
        quadratic,
        cubic,
        covaryingLatentCurve: true,
        additionalFitMeasures: true,
        rSquared: true,
        standardizedEstimate: false,
        standardizedEstimateType: "all",
        syntax: false,
        pathPlot: true,
        pathPlotParameter: true,
        pathPlotMean: false,
        curvePlot: false,
        naAction: "fiml",
        estimator: "default",
        emulation: "lavaan",
        errorCalculationMethod: "standard",
        ciLevel: 0.95,
        impliedCovariance: false,
        residualCovariance: false,
      };
    },
    apaHint:
      "报告截距与斜率（及指定的二次/三次）因子均值与方差、拟合指数（CFI、TLI、RMSEA、SRMR）以及协变量对增长因子的回归（如有）。时点默认按变量顺序取 0, 1, 2, …，可用 options.timings 覆盖。",
  },

};

export function listRecipes() {
  return Object.values(RECIPES);
}

export function getRecipe(key) {
  return RECIPES[key] || null;
}

// 明确的方法短语优先，避免“重复测量方差分析”被 ANOVA 抢先识别。
const METHOD_PRIORITY = [
  [/贝叶斯\s*(中介|调节)|bayesian\s*(process|mediation|moderation)|贝叶斯process/i, "process_bayesian"],
  [/贝叶斯.{0,16}广义|贝叶斯.{0,8}(二项|泊松|计数|logistic)|bayesian\s*generalized|\bbglmm\b/i, "mixed_bglmm"],
  [/贝叶斯.{0,12}(线性)?混合|bayesian\s*(linear\s*)?mixed|\bblmm\b/i, "mixed_blmm"],
  [/\bmimic\b|多重指标多重原因|mimic模型/i, "mimic"],
  [/潜变量增长|潜增长曲线|潜增长模型|增长曲线模型|latent\s*growth|\blgcm\b/i, "latent_growth"],
  [/中介|调节|mediation|moderation|hayes|process\s*模型/, "process"],
  [/验证性因子|cfa\b/, "cfa"],
  [/探索性因子|efa\b/, "efa"],
  [/主成分|pca\b/, "pca"],
  [/偏最小二乘|pls-?sem|plssem/, "plssem"],
  [/结构方程|sem\b/, "sem"],
  [/广义线性混合模型|glmm|二项混合|计数混合/, "mixed_glmm"],
  [/混合模型|随机效应|随机截距|随机斜率|mixed\s*model|lmm\b/, "mixed_lmm"],
  [/重复测量|被试内|within[- ]?subjects?/, "rm_anova"],
  [/协方差分析|ancova/, "ancova"],
  [/配对|paired/, "paired_ttest"],
];

export function detectRecipe(utterance) {
  const text = String(utterance || "").toLowerCase();
  for (const [pattern, key] of METHOD_PRIORITY) {
    if (pattern.test(text)) return key;
  }
  let best = null;
  let bestScore = 0;
  for (const recipe of Object.values(RECIPES)) {
    let score = 0;
    for (const keyword of recipe.keywords) {
      if (text.includes(keyword.toLowerCase())) score += keyword.length >= 3 ? 2 : 1;
    }
    if (score > bestScore) {
      best = recipe.key;
      bestScore = score;
    }
  }
  return best;
}
