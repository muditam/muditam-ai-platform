export const BIOMARKER_CATALOGUE_VERSION = "0.1.0" as const;

export interface BiomarkerDefinition {
  canonicalCode: string;
  canonicalName: string;
  panel: string;
  standardUnit?: string;
  aliases: readonly string[];
}

function definition(
  canonicalCode: string,
  canonicalName: string,
  panel: string,
  standardUnit: string | undefined,
  aliases: readonly string[] = [],
): BiomarkerDefinition {
  return {
    canonicalCode,
    canonicalName,
    panel,
    ...(standardUnit ? { standardUnit } : {}),
    aliases: [canonicalName, ...aliases],
  };
}

export const biomarkerCatalogue: readonly BiomarkerDefinition[] = [
  definition("HBA1C", "HbA1c", "DIABETES", "%", [
    "Glycosylated Hemoglobin (HbA1c)",
    "HbA1c (Glycosylated Hemoglobin)",
    "Glycated Hemoglobin",
    "Glycosylated Haemoglobin",
    "A1C",
  ]),
  definition(
    "ESTIMATED_AVERAGE_GLUCOSE",
    "Estimated Average Glucose",
    "DIABETES",
    "mg/dL",
    ["eAG", "Average Estimated Glucose"],
  ),
  definition("FASTING_GLUCOSE", "Fasting Glucose", "DIABETES", "mg/dL", [
    "Glucose Fasting",
    "Blood Sugar Fasting",
    "Fasting Blood Sugar",
    "FBS",
  ]),
  definition(
    "POSTPRANDIAL_GLUCOSE",
    "Postprandial Glucose",
    "DIABETES",
    "mg/dL",
    ["Post Prandial Blood Sugar", "PPBS"],
  ),
  definition("RANDOM_GLUCOSE", "Random Glucose", "DIABETES", "mg/dL", [
    "Random Blood Sugar",
    "RBS",
  ]),
  definition("FASTING_INSULIN", "Fasting Insulin", "DIABETES", "µIU/mL"),

  definition("BILIRUBIN_TOTAL", "Total Bilirubin", "LIVER", "mg/dL", [
    "Bilirubin Total",
  ]),
  definition("BILIRUBIN_DIRECT", "Direct Bilirubin", "LIVER", "mg/dL", [
    "Bilirubin Direct",
  ]),
  definition("BILIRUBIN_INDIRECT", "Indirect Bilirubin", "LIVER", "mg/dL", [
    "Bilirubin Indirect",
  ]),
  definition("AST", "Aspartate Aminotransferase", "LIVER", "U/L", [
    "AST",
    "SGOT",
    "SGOT/AST",
    "Aspartate Aminotransferase (AST/SGOT)",
  ]),
  definition("ALT", "Alanine Aminotransferase", "LIVER", "U/L", [
    "ALT",
    "SGPT",
    "SGPT/ALT",
    "Alanine Aminotransferase (ALT/SGPT)",
  ]),
  definition("AST_ALT_RATIO", "AST/ALT Ratio", "LIVER", "ratio", [
    "SGOT/SGPT Ratio",
  ]),
  definition("ALKALINE_PHOSPHATASE", "Alkaline Phosphatase", "LIVER", "U/L", [
    "ALP",
  ]),
  definition("GGT", "Gamma-Glutamyl Transferase", "LIVER", "U/L", [
    "Gamma Glutamyl Transferase (GGT)",
  ]),
  definition("TOTAL_PROTEIN", "Total Protein", "LIVER", "g/dL"),
  definition("ALBUMIN", "Albumin", "LIVER", "g/dL"),
  definition("GLOBULIN", "Globulin", "LIVER", "g/dL"),
  definition(
    "ALBUMIN_GLOBULIN_RATIO",
    "Albumin/Globulin Ratio",
    "LIVER",
    "ratio",
    ["Albumin :Globulin Ratio", "A/G Ratio"],
  ),

  definition("BLOOD_UREA", "Blood Urea", "KIDNEY", "mg/dL"),
  definition("BUN", "Blood Urea Nitrogen", "KIDNEY", "mg/dL", ["Bun"]),
  definition("CREATININE", "Creatinine", "KIDNEY", "mg/dL", [
    "Serum Creatinine",
  ]),
  definition("EGFR", "Estimated Glomerular Filtration Rate", "KIDNEY", "mL/min/1.73 m²", [
    "eGFR",
    "eGFR (CKD-EPI)",
  ]),
  definition("BUN_CREATININE_RATIO", "BUN/Creatinine Ratio", "KIDNEY", "ratio", [
    "Bun/Creatinine Ratio",
  ]),
  definition(
    "UREA_CREATININE_RATIO",
    "Urea/Creatinine Ratio",
    "KIDNEY",
    "ratio",
    ["Urea / Creatinine Ratio"],
  ),
  definition("URIC_ACID", "Uric Acid", "KIDNEY", "mg/dL"),
  definition("CALCIUM", "Calcium", "KIDNEY", "mg/dL", ["Calcium Serum"]),
  definition("PHOSPHORUS", "Phosphorus", "KIDNEY", "mg/dL"),
  definition("SODIUM", "Sodium", "KIDNEY", "mmol/L"),
  definition("POTASSIUM", "Potassium", "KIDNEY", "mmol/L"),
  definition("CHLORIDE", "Chloride", "KIDNEY", "mmol/L"),

  definition("TOTAL_CHOLESTEROL", "Total Cholesterol", "LIPID", "mg/dL"),
  definition("TRIGLYCERIDES", "Triglycerides", "LIPID", "mg/dL", [
    "Serum Triglycerides",
  ]),
  definition("HDL_CHOLESTEROL", "HDL Cholesterol", "LIPID", "mg/dL", [
    "HDL",
    "Serum HDL Cholesterol",
  ]),
  definition("LDL_CHOLESTEROL", "LDL Cholesterol", "LIPID", "mg/dL", [
    "LDL",
    "LDL Cholesterol Direct",
    "LDL Cholesterol Calculated",
  ]),
  definition("VLDL_CHOLESTEROL", "VLDL Cholesterol", "LIPID", "mg/dL", [
    "V.L.D.L Cholesterol",
  ]),
  definition("NON_HDL_CHOLESTEROL", "Non-HDL Cholesterol", "LIPID", "mg/dL", [
    "Non HDL Cholesterol",
  ]),
  definition("CHOLESTEROL_HDL_RATIO", "Cholesterol/HDL Ratio", "LIPID", "ratio", [
    "Chol/HDL Ratio",
  ]),
  definition("HDL_LDL_RATIO", "HDL/LDL Ratio", "LIPID", "ratio", [
    "HDL/ LDL Ratio",
  ]),
  definition("LDL_HDL_RATIO", "LDL/HDL Ratio", "LIPID", "ratio"),

  definition("ESR", "Erythrocyte Sedimentation Rate", "INFLAMMATION", "mm/hr", [
    "ESR",
    "ESR - Erythrocyte Sedimentation Rate",
  ]),
  definition("CRP", "C-Reactive Protein", "INFLAMMATION", "mg/L", ["CRP"]),
  definition("HS_CRP", "High-Sensitivity C-Reactive Protein", "INFLAMMATION", "mg/L", [
    "hs-CRP",
  ]),

  definition("HEMOGLOBIN", "Hemoglobin", "CBC", "g/dL", ["Haemoglobin", "Hb", "HGB"]),
  definition("RBC_COUNT", "RBC Count", "CBC", "10^6/µL"),
  definition("HEMATOCRIT", "Hematocrit", "CBC", "%", ["PCV", "Packed Cell Volume"]),
  definition("MCV", "Mean Corpuscular Volume", "CBC", "fL", ["MCV"]),
  definition("MCH", "Mean Corpuscular Hemoglobin", "CBC", "pg", ["MCH"]),
  definition("MCHC", "Mean Corpuscular Hemoglobin Concentration", "CBC", "g/dL", ["MCHC"]),
  definition("RDW_CV", "RDW-CV", "CBC", "%", ["RDW (CV)"]),
  definition("RDW_SD", "RDW-SD", "CBC", "fL"),
  definition("TOTAL_LEUKOCYTE_COUNT", "Total Leukocyte Count", "CBC", "10^3/µL", [
    "TLC",
    "WBC Count",
  ]),
  definition("NEUTROPHILS_PERCENT", "Neutrophils", "CBC", "%"),
  definition("LYMPHOCYTES_PERCENT", "Lymphocytes", "CBC", "%"),
  definition("MONOCYTES_PERCENT", "Monocytes", "CBC", "%"),
  definition("EOSINOPHILS_PERCENT", "Eosinophils", "CBC", "%"),
  definition("BASOPHILS_PERCENT", "Basophils", "CBC", "%"),
  definition("ABSOLUTE_NEUTROPHIL_COUNT", "Absolute Neutrophil Count", "CBC", "10^3/µL", [
    "Neutrophils.",
  ]),
  definition("ABSOLUTE_LYMPHOCYTE_COUNT", "Absolute Lymphocyte Count", "CBC", "10^3/µL", [
    "Lymphocytes.",
  ]),
  definition("ABSOLUTE_MONOCYTE_COUNT", "Absolute Monocyte Count", "CBC", "10^3/µL", [
    "Monocytes.",
  ]),
  definition("ABSOLUTE_EOSINOPHIL_COUNT", "Absolute Eosinophil Count", "CBC", "10^3/µL", [
    "Eosinophils.",
  ]),
  definition("ABSOLUTE_BASOPHIL_COUNT", "Absolute Basophil Count", "CBC", "10^3/µL", [
    "Basophils.",
  ]),
  definition("PLATELET_COUNT", "Platelet Count", "CBC", "10^3/µL"),
  definition("MEAN_PLATELET_VOLUME", "Mean Platelet Volume", "CBC", "fL", [
    "Mean Platelet Volume (MPV)",
    "MPV",
  ]),
  definition("PLATELETCRIT", "Plateletcrit", "CBC", "%", ["PCT"]),
  definition("PLATELET_DISTRIBUTION_WIDTH", "Platelet Distribution Width", "CBC", "fL", ["PDW"]),
  definition("PLATELET_LARGE_CELL_RATIO", "Platelet Large Cell Ratio", "CBC", "%", ["P-LCR"]),
  definition("PLATELET_LARGE_CELL_COUNT", "Platelet Large Cell Count", "CBC", "10^9/L", ["P-LCC"]),
  definition("MENTZER_INDEX", "Mentzer Index", "CBC", undefined),

  definition("T3_TOTAL", "Total Triiodothyronine", "THYROID", "ng/dL", [
    "Triiodothyronine (T3)",
    "T3 Total",
  ]),
  definition("T4_TOTAL", "Total Thyroxine", "THYROID", "µg/dL", [
    "Total Thyroxine (T4)",
    "T4 Total",
  ]),
  definition("TSH", "Thyroid Stimulating Hormone", "THYROID", "µIU/mL", [
    "Thyroid Stimulating Hormone (Ultrasensitive)",
  ]),
  definition("FREE_T3", "Free T3", "THYROID", "pg/mL", ["FT3"]),
  definition("FREE_T4", "Free T4", "THYROID", "ng/dL", ["FT4"]),

  definition("VITAMIN_B12", "Vitamin B12", "VITAMIN", "pg/mL", [
    "Vitamin - B12",
    "Cyanocobalamin",
  ]),
  definition("VITAMIN_D_25_HYDROXY", "Vitamin D 25-Hydroxy", "VITAMIN", "ng/mL", [
    "Vitamin D 25 - Hydroxy",
    "25-OH Vitamin D",
  ]),
];

export function normalizeBiomarkerName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/haemoglobin/g, "hemoglobin")
    .replace(/\.\s*\*?\s*$/, " absolute")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const aliasIndex = new Map<string, BiomarkerDefinition>();
for (const entry of biomarkerCatalogue) {
  for (const alias of entry.aliases) {
    const normalized = normalizeBiomarkerName(alias);
    const existing = aliasIndex.get(normalized);
    if (existing && existing.canonicalCode !== entry.canonicalCode) {
      throw new Error(`Duplicate biomarker alias: ${alias}`);
    }
    aliasIndex.set(normalized, entry);
  }
}

export function findBiomarker(
  rawName: string,
): BiomarkerDefinition | undefined {
  return aliasIndex.get(normalizeBiomarkerName(rawName));
}
