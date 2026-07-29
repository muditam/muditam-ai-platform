import { z } from "zod";

export const productCategorySchema = z.enum([
  "blood_sugar",
  "liver",
  "heart",
  "daily_wellness",
  "digestive_health",
  "sleep_stress",
  "mens_wellness",
  "nerve_health",
  "thyroid",
  "bone_health",
]);

export const metabolicProductSchema = z.object({
  sku: z.string().trim().min(1),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  category: productCategorySchema,
  indication: z.string().trim().min(1),
  composition: z.string().trim().min(1),
  applicableBiomarkers: z.array(z.string().trim().min(1)),
  keyIngredients: z.array(z.string().trim().min(1)),
  recommendedDosage: z.string().trim().min(1),
  productUrl: z.url().nullable(),
  contraindications: z.array(z.string().trim().min(1)),
  safetyNotes: z.array(z.string().trim().min(1)),
  recommendationStatus: z.literal("test_only"),
  catalogVersion: z.literal("1.0.0-test"),
  active: z.boolean(),
});

export type MetabolicProduct = z.infer<typeof metabolicProductSchema>;

type ProductMetadata = Pick<
  MetabolicProduct,
  | "category"
  | "indication"
  | "applicableBiomarkers"
  | "keyIngredients"
> & {
  contraindications?: string[];
  safetyNotes?: string[];
};

const LABEL_DIRECTED_DOSAGE =
  "Use only as directed on the product label or by a qualified healthcare professional.";
const DEFAULT_CONTRAINDICATIONS = [
  "Do not use if allergic to any listed ingredient.",
  "Seek professional advice during pregnancy, breastfeeding, for children, or while taking medication.",
];
const DEFAULT_SAFETY_NOTES = [
  "Test catalog metadata only; clinical and regulatory approval is pending.",
  "This product must not be presented as a diagnosis, cure, or replacement for prescribed treatment.",
];

const RAW_PRODUCT_COMPOSITIONS = `
Karela Jamun Fizz	Acidity Regulator [INS 500 (II), INS 330], Karela Extract, Jamun Extract, Gudmar Extract, Chiraita Extract, Vijaysar Extract, Neem Extract, Methi Extract, Amla Extract, Paneer Doda Extract, Ashwagandha Extract, Giloy Extract, Colour (INS 133), Artificial flavour (Jamun), Sweetener (INS 955)
Sugar Defend Pro	Magnesium (as Magnesium gluconate), Alpha Lipoic Acid, Evening Primrose Oil, Inositol, Zinc Citrate, Vitamin E (as Di-Tocopherol Acetate), Vitamin A (as Retinyl Acetate), Chromium (as Chromium Picolinate), Folic Acid, Selenium (as Sodium Selenate), Biotin, Berberine HCL 50% (as Berberies Aristata), Wild Bitter Melon Fruit Extract, Chlorella Vulgaris, Vitamin B12, Metavive (Salacia Extract), Anticaking Agent [INS 551, INS 470 (III), INS 553 (III)], Glazing Agent [INS 553 (III)], Glident [INS 470 (III)], Starch, Stabilizer [INS 460 (I), INS 341 (II)], Thickener (INS 464), Class II Preservatives and Disintegrant (INS 468)
Liver Fix	Acidity Regulator [INS 500 (II), INS 330], Sweetener (INS 420), Milk Thistle (Silymarin-80%) Extract, N-Acetyl L-Cysteine, Kutaki Extract, Dandelion Extract, Gingko Biloba Extract, Licorice Extract, Curcumin Extract, Ginger Extract, Arjuna Extract, Beetroot Extract, Stevia, Preservatives- MPS (INS 219), PPS (INS 217), Contains Permitted Synthetic Food Colour (INS 124) & Nature Identical Flavour (Lemon).
Heart Defend Pro	Beta Sitosterol, Coenzyme Q10, Arjuna Bark Extract, Aged Garlic Extract, Bergamot Orange Fruit Extract, Stigmasterol, Campesterol, Alpha Lipoic Acid, Lycopene 10%, Vitamin E (D-alpha-tocopherol), Anticaking agent [INS 470 (III)], Starch, Anticaking agent [INS 553 (III)], Preservative (INS 219, INS 217), Color [INS 172 (II)]
Amla Orange Fizz	Amla Dried Fruit (Emblica officinalis) Extract, Vitamin C, Zinc Sulphate, Maltodextrin, Acidity Regulator [INS 500 (II), INS 330], Preservatives (INS 219, INS 217), Color (INS 110), Artificial Flavour (Orange)
Chandraprabha Vati	Shilajatu Pdr, Shudh Guggul Exd, Sharkara Pdr, Loha Bhasma, Nishoth Rt, Danti Rt, Patra Lf, Dal Chini St.Bk., Vamshalochana S.C., Badi Elachi Fr., Kapur Kachri Rt., Vacha Rz., Nagarmotha Rz., Chirayita Pl., Giloy St., Devdar St., Haridra Rz., Ativisha Rt., Daru Haldi Rt. Bk., Pippalimoola Rt., Chitraka Rt. Bk., Dhanyaka Fr., Haritaki Fr., Vibhitaki Fr., Amalaki Fr., Chavya Rt., Vidanga Fr., Badi Pippali Fr., Chhoti Pippali Fr., Shunti Rz., Kali Mirch Fr., Swarna Makshika Bhasma, Yava Kshara, Swarjika Kshara, Saindhava Lavana, Sauvarchala Lavana, Vida Lavana, Chhoti Elachi Fr., Kabab Chini Fr., Gokhru Fr., Shvet Chandan Ht.Wd., Bhavna dravya
Performance Forever for Him	Gokshur Extract, Kaunch Beej Extract, Ashwagandha Extract, Fenugreek, Safed Musli Extract, Korean Ginseng, L Arginine, Ginger Root Extract, L citrulline, Zinc Sulphate, Anticaking agent [INS 470 (III)], Starch, Anticaking agent [INS 553 (III)), Preservative (INS 219, INS 217), Color [INS 172 (I)]
Stress and Sleep	KSM Ashwagandha Root Extract, Valerian Root, Shankhpushpi Ext, Brahmi Extract, L-Theanine, Tryptophan, L-Threonine, Chamomile, Melatonin, Anticaking Agent [INS 551, INS 470 (III), INS 553 (III)], Glazing Agent [INS 553 (III)], Glident [INS 470 (III)], Starch, Stabilizer [INS 460 (I), INS 341 (II)], Thickener (INS 464), Class II Preservatives and Disintegrant (INS 468)
Vasant Kusmakar Ras	Moti Bhasma, Abhrak Bhasma, Praval Bhasma, Vang Bhasma, Loh Bhasma, Nag Bhasma, Swarn Bhasma, Rajat Bhasma, Bhavna Dravya (Gow dugdh, Ukh swaras, Adusa kwath, Lakh swaras, Sugandhbala kwath, Kadlikand swaras, Kamal pushp swaras, Malti pushp swaras, Kasturi rahit)
Power Gut (30 sachets)	Sweetener [INS 420 (i)], Stabilizer (INS 967), Jamun (Syzygium cuminii) extract, Amla (Emblica officinalis) extract, Fructooligosaccharides, L. acidophilus, L. reuteri, L. fermentum, B. bifidum, Acidity regulator (INS 330), Anti-caking agent (INS 551), Anti-sticking agent [INS 470 (iii)], Selenomethionine & Chromium picolinate
Power Gut (15 sachets)	Sweetener [INS 420 (i)], Stabilizer (INS 967), Jamun (Syzygium cuminii) extract, Amla (Emblica officinalis) extract, Fructooligosaccharides, L. acidophilus, L. reuteri, L. fermentum, B. bifidum, Acidity regulator (INS 330), Anti-caking agent (INS 551), Anti-sticking agent [INS 470 (iii)], Selenomethionine & Chromium picolinate
Shilajit with Gold	Shilajit Shudh (Asphaltum Punjabianum) Exudate, Ashwagandha (Withania Somnifera Dunal) Rt., Safed Musli (Chlorophytum Borivilianum) Tub. Rt., Gokharu (Tribulus Terrestris) Frt., Atmagupta (Mucuna Prurita Hook) Sd., Svarna Bhasma (Shastriya Aushadhi), Svarna Vanga (Shastriya Aushadhi)
Nerve Fix	Horse Chestnut Seed Extract (Aesculus hippocastanum) – Standardized to 20% Aescin, Alpha Lipoic Acid, Acetyl L-Carnitine HCl, Dicalcium Phosphate, Curcumin Extract (Curcuma longa), Brahmi Extract (Bacopa monnieri), Korean Ginseng (Panax ginseng), Spirulina Extract (Arthrospira platensis), Maize Starch (Disintegrant), Diluent (Microcrystalline cellulose), Binding agent (INS 1201), Vitamin B5 (as Pantothenic Acid), Coating Agent (INS 462), Lactose, Coating agent (Hydroxypropyl Methylcellulose), Vitamin B2 (as Riboflavin), Vitamin B1 (as Thiamine), Sunset yellow FCF (INS 110), Class II Preservatives, Vitamin B9 (as Folic Acid), Liposomal Vitamin D3 (as Cholecalciferol), Liposomal Vitamin B12 (as Cyanocobalamin).
Liver Defend Pro	Milk Thistle (Silybum marianum) Extract, Dandelion (Taraxacum officinale) Extract, Lactose (Diluent), Hydroxy propyl methyl cellulose (Coating agent), Kutaki (Picrorhiza kurroa) Extract, Turmeric (Curcuma longa) Extract, Kasani (Cichorium endivia) Extract, Povidone (Binding agent), Microcrystalline cellulose (INS 460(i)), Dicalcium Phosphate (Diluent), Maize starch (Disintegrant), Punarnava (Boerhavia diffusa L.) Extract, Tamlaki (Phyllanthus amarus) Extract, Madhuyasti (Glycyrrhiza glabra L.) Extract, Resveratrol, Sodium Starch Glycolate (Binder), Magnesium Stearate (Anticaking agent), Cinnamon (Cinnamomum verum) Extract, Arjun (Terminalia arjuna Roxb.) Extract, Indian Nightshade (Solanum indicum) Extract, Himsraa (Capparis spinosa Linn.) Extract, Talc (INS 553(iii)), Vitamin E (as DL-alpha-tocopherol), Kasmard (Cassia occidentalis L.) Extract, Gandana (Achillea millefolium Linn.) Extract, Black pepper (Piper nigrum L.) Extract, Colour (Ponceau 4R (INS 124)).
Omega Fuel	Salmon Fish Oil, Ingredients of capsules shell (Gelatin), Humectants (INS 420 (i) & INS 422), Preservative (INS 211) & Antioxidants (INS 320 & INS 321)
Thyroid Defend Pro	Ashwagandha (Withania somnifera) Extract, L-Tyrosine, Magnesium (as Magnesium Sulphate), Guggul (Commiphora wightii) Extract, Lactose (Diluent), Vitamin C (as Ascorbic Acid), Microcrystalline Cellulose (INS 460 (i)), Sodium Starch Glycolate (Binder), Dicalcium Phosphate (Binder), Povidone (Binding agent), Maize Starch (Disintegrant), Magnesium Stearate (Anti-caking), Talc (INS 553 (iii)), Vitamin B3 (as Niacinamide), Zinc (as Zinc Sulphate), Vitamin E (as DL-Alpha Tocopherol Acetate), Vitamin B5 (as Pantothenic Acid), Vitamin B2 (as Riboflavin), Vitamin B6 (as Pyridoxine Hydrochloride), Vitamin B1 (as Thiamine Mononitrate), Manganese (as Manganese Chloride), Vitamin A (as Retinol Acetate), Copper (as Cupric Citrate), Iodine (as Sodium Iodide), Selenium (as Sodium Selenite), Biotin (as D-Biotin), Vitamin K (as Menaquinone-7), Chromium (as Chromium Chloride), Vitamin D3 (Cholecalciferol), Vitamin B12 (as Cyanocobalamin).
Core Essentials	Vitamin B3 (as Nicotinamide) 18 mg, Vitamin B5 (as Calcium D Pantothenate) 5 mg, Vitamin B2 (as Riboflavin) 2.5 mg, Vitamin B6 (as Pyridoxine HCl) 2.4 mg, Vitamin B1 (as Thiamine Mononitrate) 1.8 mg, Vitamin A (as Retinyl Acetate) 1000 mcg, Vitamin B9 (as Folic Acid) 176.47 mcg, Vitamin K2 (as MK-7) 55 mcg, Vitamin D2 (as Ergocalciferol) (600 IU) 15 mcg, Vitamin B12 (as Cyanocobalamin) 2.2 mcg, Magnesium (from Magnesium Oxide 42.3 mg) 25.5 mg, Calcium (from Calcium Carbonate 48.75 mg) 19.5 mg, Zinc (from Zinc Sulphate) 17 mg, Iron (from Carbonyl Iron) 9.5 mg, Manganese (from Manganese Sulphate) 4 mg, Copper (from Cupric Sulphate) 1.7 mg, Chromium Picolinate 400 mcg, Iodine (from Potassium Iodide) 140 mcg, Boron (from Boric Acid) 75 mcg, Molybdenum (from Sodium Molybdate Dihydrate) 45 mcg, Selenium (from Sodium Selenite) 40 mcg, Panax Korean Ginseng Rhizome Extract (3% Ginsenosides) (100mg) & Echinacea purpurea Powder Extract (20mg), Cranberry (Vaccinium oxycoccos)- fruit dried Extract (5mg), Mixed Carotenoids(10%) (5000mcg), Grape Seed Extract- 95% Proanthocyanidin (2000mcg), Zeaxanthin 5% Powder(1000mcg), Elderberry (Sambucus nigra) Extract (1000mcg), Algae Powder Astaxanthin(10%) (Haematococcus pluvialis) (1000mcg), Alpha Lipoic Acid (500mcg), Lycopene (6% Powder) (500mcg), L-Glutamic Acid 12.36 mg, DL-Methionine 8 mg (1.23%^), L-Aspartic Acid 7.24 mg, L-Arginine 4.7 mg, L-Lysine 3.92 mg (0.20%^), L-Proline 3.2 mg, L-Serine 3.2 mg, L-Phenylalanine 3.2 mg (0.19%^), Glycine 2.56 mg, L-Tyrosine 2.38 mg (0.14%^), L-Alanine 2.38 mg, L-Threonine 2.26 mg (0.23%^), L-Histidine 1.54 mg (0.23%^), L-Cysteine 0.78 mg (0.3%^), L-Tryptophan 0.72 mg (0.27%^), Leucine 4.76 mg (0.18%^), Isoleucine 2.8 mg (0.21%^), Valine 2.8 mg (0.16%^), Chilgoza Pine (Pinus gerardiana Bark) Extract (20 mg), Kaunch Beej (Mucuna pruriens) (10mg), Lactobacillus acidophilus 62.5 Million cfu, Lacticaseibacillus rhamnosus 62.5 Million cfu, Bifidobacterium longum 62.5 Million cfu, Sacchromyces boulardii 62.5 Million cfu, Total Count 250 Million cfu, Fructooligosachharides (25mg), Turmeric (Curcuma longa Rhizome) Powder (10mg), Alfalfa (Medicago sativa) Extract (10mg), Moringa (Moringa oleifera) Bark Powder (5mg), Hyaluronic acid (1mg), Fenugreek (Trigonella-foenum-graecum-seeds) Extract (20mg), Green Coffee Bean (Coffee arabica seeds) Extract (10mg), Green Tea (Camellia sinensis leaf) Extract (10mg), Papain (10mg), Bromelain (Ananas comosus) (10mg), Alpha Amylase (5mg), Lipase Enzyme (5mg), Garlic bulb (Allium sativum) Extract (5mg), Vitamin C (L-Ascorbic Acid) 20mg (25%*), Aloe Vera Sap Extract (Concentrated) 10mg, Vitamin E(D-Alpha Tocopheryl Acetate) 10mg (100%*), Amla (Emblica officinalis-dried fruit) Extract 5mg (100%*), Brahmi Extract (Leaf) (10mg), Choline Bitartrate (5000mcg), Inositol (5000mcg), Lutein (6% Powder) (1000mcg), Flaxseed (Linum usitatissimum seed) Extract (10mg), Blueberry (Vaccinium corymbosum-dried fruit) concentrate (1000mcg). Other Ingredients: Diluent (INS 460 (i), INS 341 (iii)), Binder (Maize starch), Glazing Agent (INS 464), Anticaking Agent (INS 553(iii)), Thickening Agent (INS 466), Glidant (INS 470(iii)) & Potassium Sorbate (INS 202), Contains permitted natural food colors (INS 172(i), INS 172(ii), INS 172(iii)).
Snooze Well	Sweetener (INS 420), L-Tryptophan, Tagara Root (Valeriana wallichii) Extract, Stevia, L-Theanine, Chamomile (Matricaria chamomilla), L-Threonine, Melatonin, Vitamin B6 (as Pyridoxine HCl), Preservative (Potassium Sorbate, INS 202), Contains Permitted Synthetic Food Colour (Caramel, INS 150b) & Nature Identical Flavour (Peppermint)
Bone Dense	Calcium Citrate Tetrahydrate, Starch, Magnesium Oxide, Colour Titanium dioxide (INS 171), Talc ((INS 553(iii)), Zinc Gluconate, Magnesium Stearate, Boron (as Boron Proteonate), Preservatives- MPS(INS 219), PPS(INS 217), Vitamin K2(MK-7)(Menaquinone), Vitamin D3 (Cholecalciferol).
Berberine Pro	Veg capsule shell [INS 464], Daruhaldi Extract, Liposomal Berberine, Gudmar Extract, Cinnamon Bark Extract, Bitter Melon Extract, Anticaking agent [INS 551], Glidant [INS 470 (iii)], Black Pepper Fruit Extract, Glazing Agent [INS 553 (iii)], Chromium Picolinate.
`.trim();

const PRODUCT_METADATA: Record<string, ProductMetadata> = {
  "Karela Jamun Fizz": { category: "blood_sugar", indication: "Test metadata for nutritional support related to glucose metabolism.", applicableBiomarkers: ["hba1c", "fasting_glucose", "post_prandial_glucose"], keyIngredients: ["Karela Extract", "Jamun Extract", "Gudmar Extract", "Methi Extract"] },
  "Sugar Defend Pro": { category: "blood_sugar", indication: "Test metadata for nutritional support related to glucose metabolism.", applicableBiomarkers: ["hba1c", "fasting_glucose", "post_prandial_glucose"], keyIngredients: ["Berberine HCL", "Bitter Melon Extract", "Chromium Picolinate", "Salacia Extract"] },
  "Liver Fix": { category: "liver", indication: "Test metadata for liver-health nutritional support.", applicableBiomarkers: ["alt", "ast", "ggt", "bilirubin"], keyIngredients: ["Milk Thistle Extract", "N-Acetyl L-Cysteine", "Kutaki Extract", "Dandelion Extract"] },
  "Heart Defend Pro": { category: "heart", indication: "Test metadata for cardiovascular and lipid nutritional support.", applicableBiomarkers: ["total_cholesterol", "ldl", "hdl", "triglycerides"], keyIngredients: ["Beta Sitosterol", "Coenzyme Q10", "Aged Garlic Extract", "Bergamot Extract"] },
  "Amla Orange Fizz": { category: "daily_wellness", indication: "Test metadata for vitamin C, zinc, and general nutritional support.", applicableBiomarkers: [], keyIngredients: ["Amla Extract", "Vitamin C", "Zinc Sulphate"] },
  "Chandraprabha Vati": { category: "blood_sugar", indication: "Test metadata for traditional metabolic-wellness support.", applicableBiomarkers: ["hba1c", "fasting_glucose"], keyIngredients: ["Shilajatu", "Shudh Guggul", "Giloy", "Haridra"], safetyNotes: ["Traditional formulation containing bhasma ingredients; professional supervision is required."] },
  "Performance Forever for Him": { category: "mens_wellness", indication: "Test metadata for men's energy and performance nutritional support.", applicableBiomarkers: [], keyIngredients: ["Gokshur Extract", "Kaunch Beej Extract", "Ashwagandha Extract", "Safed Musli Extract"] },
  "Stress and Sleep": { category: "sleep_stress", indication: "Test metadata for sleep and stress support.", applicableBiomarkers: [], keyIngredients: ["Ashwagandha Extract", "Valerian Root", "L-Theanine", "Melatonin"], contraindications: ["May cause drowsiness; do not combine with sedatives or drive after use without professional advice."] },
  "Vasant Kusmakar Ras": { category: "blood_sugar", indication: "Test metadata for traditional metabolic-wellness support.", applicableBiomarkers: ["hba1c", "fasting_glucose"], keyIngredients: ["Abhrak Bhasma", "Vang Bhasma", "Swarn Bhasma", "Rajat Bhasma"], safetyNotes: ["Traditional bhasma formulation; use only under qualified professional supervision."] },
  "Power Gut (30 sachets)": { category: "digestive_health", indication: "Test metadata for digestive and microbiome nutritional support.", applicableBiomarkers: [], keyIngredients: ["Fructooligosaccharides", "L. acidophilus", "B. bifidum", "Jamun Extract"] },
  "Power Gut (15 sachets)": { category: "digestive_health", indication: "Test metadata for digestive and microbiome nutritional support.", applicableBiomarkers: [], keyIngredients: ["Fructooligosaccharides", "L. acidophilus", "B. bifidum", "Jamun Extract"] },
  "Shilajit with Gold": { category: "mens_wellness", indication: "Test metadata for men's vitality and energy support.", applicableBiomarkers: [], keyIngredients: ["Shilajit", "Ashwagandha", "Safed Musli", "Svarna Bhasma"], safetyNotes: ["Contains traditional bhasma ingredients; professional supervision is required."] },
  "Nerve Fix": { category: "nerve_health", indication: "Test metadata for nerve-health nutritional support.", applicableBiomarkers: ["vitamin_b12", "vitamin_d"], keyIngredients: ["Alpha Lipoic Acid", "Acetyl L-Carnitine", "Vitamin B12", "Vitamin D3"] },
  "Liver Defend Pro": { category: "liver", indication: "Test metadata for liver-health nutritional support.", applicableBiomarkers: ["alt", "ast", "ggt", "bilirubin"], keyIngredients: ["Milk Thistle Extract", "Dandelion Extract", "Kutaki Extract", "Turmeric Extract"] },
  "Omega Fuel": { category: "heart", indication: "Test metadata for omega-3 and lipid nutritional support.", applicableBiomarkers: ["total_cholesterol", "ldl", "hdl", "triglycerides"], keyIngredients: ["Salmon Fish Oil"], contraindications: ["Contains fish and gelatin.", "Seek professional advice when using anticoagulant or antiplatelet medication."] },
  "Thyroid Defend Pro": { category: "thyroid", indication: "Test metadata for thyroid-related nutritional support.", applicableBiomarkers: ["tsh", "free_t3", "free_t4"], keyIngredients: ["Ashwagandha Extract", "L-Tyrosine", "Iodine", "Selenium"], contraindications: ["Do not combine with thyroid medication without clinician review."] },
  "Core Essentials": { category: "daily_wellness", indication: "Test metadata for broad vitamin, mineral, amino-acid, and probiotic support.", applicableBiomarkers: ["vitamin_b12", "vitamin_d", "iron", "calcium", "magnesium"], keyIngredients: ["Multivitamins", "Minerals", "Amino Acids", "Probiotics"] },
  "Snooze Well": { category: "sleep_stress", indication: "Test metadata for sleep support.", applicableBiomarkers: [], keyIngredients: ["L-Tryptophan", "Valerian Extract", "L-Theanine", "Melatonin"], contraindications: ["May cause drowsiness; do not combine with sedatives or drive after use without professional advice."] },
  "Bone Dense": { category: "bone_health", indication: "Test metadata for bone-health nutritional support.", applicableBiomarkers: ["vitamin_d", "calcium", "magnesium"], keyIngredients: ["Calcium Citrate", "Magnesium Oxide", "Vitamin K2", "Vitamin D3"], contraindications: ["Seek professional advice with kidney disease, kidney stones, or medicines affected by calcium/vitamin K."] },
  "Berberine Pro": { category: "blood_sugar", indication: "Test metadata for nutritional support related to glucose and lipid metabolism.", applicableBiomarkers: ["hba1c", "fasting_glucose", "post_prandial_glucose", "triglycerides"], keyIngredients: ["Liposomal Berberine", "Gudmar Extract", "Cinnamon Bark Extract", "Bitter Melon Extract"], contraindications: ["Seek professional advice when using glucose-lowering medication."] },
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseCompositionRows(source: string): Array<{ sku: string; composition: string }> {
  return source.split("\n").map((line, index) => {
    const separatorIndex = line.indexOf("\t");
    if (separatorIndex <= 0) throw new Error(`Invalid product composition row ${index + 1}.`);
    return {
      sku: line.slice(0, separatorIndex).trim(),
      composition: line.slice(separatorIndex + 1).replace(/\s+/g, " ").trim(),
    };
  });
}

const parsedProducts = parseCompositionRows(RAW_PRODUCT_COMPOSITIONS).map(({ sku, composition }) => {
  const metadata = PRODUCT_METADATA[sku];
  if (metadata === undefined) throw new Error(`Missing test metadata for product SKU "${sku}".`);
  return metabolicProductSchema.parse({
    sku,
    slug: slugify(sku),
    name: sku,
    composition,
    ...metadata,
    recommendedDosage: LABEL_DIRECTED_DOSAGE,
    productUrl: null,
    contraindications: [...DEFAULT_CONTRAINDICATIONS, ...(metadata.contraindications ?? [])],
    safetyNotes: [...DEFAULT_SAFETY_NOTES, ...(metadata.safetyNotes ?? [])],
    recommendationStatus: "test_only",
    catalogVersion: "1.0.0-test",
    active: true,
  });
});

const uniqueSkus = new Set(parsedProducts.map((product) => product.sku));
if (uniqueSkus.size !== parsedProducts.length) {
  throw new Error("The static metabolic product catalog contains duplicate SKUs.");
}

export const METABOLIC_PRODUCTS: readonly MetabolicProduct[] = Object.freeze(parsedProducts);
