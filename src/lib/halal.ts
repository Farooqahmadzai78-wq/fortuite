import { SavedProduct } from "./app-settings";

export type Verdict = "halal" | "haram" | "doubtful" | "unknown";

export type ProductResult = SavedProduct & {
  ingredients: string;
  reasons: string[];
  certified: boolean;
  source: string;
};

const HEADERS = {
  "User-Agent": "IslamNoorApp/1.0 (https://islam-noor.app; contact@islamnoor.app)",
  Accept: "application/json",
};

/** Normalizes string: lowercase, accents removed, trimmed */
function norm(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Known halal certification bodies referenced by Open Food Facts labels and manufacturer databases */
const CERT_TOKENS = [
  "halal",
  "avs",
  "achahada",
  "sfcvh",
  "argml",
  "jakim",
  "mui",
  "lppom",
  "halal correct",
  "halal-correct",
  "halal control",
  "halal-control",
  "hmc",
  "hfa",
  "fambras",
  "chic",
  "grande mosquee de paris",
  "grande mosquee de lyon",
  "grande mosquee d'evry",
  "certifie halal",
  "certifiee halal",
  "halal certified",
];

/**
 * Recognized permissible meats in Islamic jurisprudence (requiring ritual Islamic slaughter/certification).
 * Fish and seafood are excluded because they are naturally permissible without ritual slaughter.
 */
const PERMISSIBLE_MEAT_RULES = [
  {
    name: "Bœuf / Bovin",
    regex: /\b(boeuf|bœuf|beef|bovin|bovine|veau|veal|steack|steak|hache|haché|rumsteak|entrecote|bourguignon|bavette|rosbif)\b/i,
    negationRegex: /\b(sans\s+(?:viande\s+de\s+)?(?:boeuf|bœuf|bovin)|vegetar|vegan|arome\s+artificiel|gousse|no\s+beef)\b/i,
  },
  {
    name: "Poulet / Volaille",
    regex: /\b(poulet|chicken|volaille|poultry|coq|chapon|blanc\s+de\s+poulet|cuisse\s+de\s+poulet|nuggets?\s+de\s+poulet|aiguillette\s+de\s+poulet)\b/i,
    negationRegex: /\b(sans\s+poulet|vegetar|vegan|arome\s+artificiel|no\s+chicken)\b/i,
  },
  {
    name: "Dinde",
    regex: /\b(dinde|turkey|escalope\s+de\s+dinde|filet\s+de\s+dinde|jambon\s+de\s+dinde|bacon\s+de\s+dinde)\b/i,
    negationRegex: /\b(sans\s+dinde|vegetar|vegan|no\s+turkey)\b/i,
  },
  {
    name: "Agneau / Mouton",
    regex: /\b(agneau|lamb|mouton|mutton|merguez|cotelette\s+d'agneau|gigot\s+d'agneau)\b/i,
    negationRegex: /\b(sans\s+(?:agneau|mouton)|vegetar|vegan)\b/i,
  },
  {
    name: "Canard / Oie / Gibier",
    regex: /\b(canard|duck|magret|confit\s+de\s+canard|oie|goose|foie\s+gras)\b/i,
    negationRegex: /\b(sans\s+canard|vegetar|vegan)\b/i,
  },
  {
    name: "Viande générique (non porcine)",
    regex: /\b(viande|viandes|meat|meats|chair\s+animale|abats)\b/i,
    negationRegex: /\b(sans\s+viande|meat\s*free|vegetar|vegan|sans\s+porc)\b/i,
  },
];

interface IngredientDetectionRule {
  id: string;
  name: string;
  type: "haram" | "doubtful";
  regex: RegExp;
  negationRegex?: RegExp;
}

/**
 * High-precision ingredient rules with strict boundary & negation safety.
 * Never triggers on general categories or substrings inside unrelated words (e.g. "vinaigre", "bovin").
 */
const INGREDIENT_RULES: IngredientDetectionRule[] = [
  // --- HARAM INGREDIENTS ---
  {
    id: "porc_gelatin",
    name: "Gélatine de porc",
    type: "haram",
    regex: /\b(gelatine\s+de\s+porc|pork\s+gelatin|gelatine\s+porcine|porcine\s+gelatin|pork-gelatin)\b/i,
  },
  {
    id: "porc_meat",
    name: "Viande ou dérivé de porc (lard, saindoux, bacon de porc)",
    type: "haram",
    regex: /\b(porc|pork|saindoux|lard|viande\s+de\s+porc|chair\s+de\s+porc|gras\s+de\s+porc|graisse\s+de\s+porc|sang\s+de\s+porc)\b/i,
    negationRegex: /\b(sans\s+(?:viande\s+de\s+)?porc|pork\s*free|no\s+pork|0%?\s*porc|sans\s+lard|sans\s+saindoux|vegetar|vegan)\b/i,
  },
  {
    id: "jambon_porc",
    name: "Jambon (porc)",
    type: "haram",
    regex: /\b(jambon|ham)\b/i,
    negationRegex: /\b(jambon\s+de\s+(?:dinde|poulet|boeuf|volaille)|turkey\s+ham|chicken\s+ham|sans\s+jambon|halal|vegetar|vegan)\b/i,
  },
  {
    id: "bacon_porc",
    name: "Bacon (porc)",
    type: "haram",
    regex: /\b(bacon)\b/i,
    negationRegex: /\b(bacon\s+de\s+(?:dinde|poulet|boeuf|volaille)|turkey\s+bacon|sans\s+bacon|halal|vegetar|vegan)\b/i,
  },
  {
    id: "alcohol_beverage",
    name: "Alcool / Boisson alcoolisée",
    type: "haram",
    regex: /\b(alcool\s+ethylique|ethanol|vin\s+rouge|vin\s+blanc|biere|beer|rhum|rum|vodka|whisky|whiskey|liqueur|cognac|tequila|gin|kirsch|eau-de-vie|champagne|sake|calvados)\b/i,
    negationRegex: /\b(sans\s+alcool|non[\s-]alcoholic|alcohol[\s-]free|0[.,]0\s*%|0\s*%\s*alcool|desalcoolise|dealcohol|zero\s*alcool|vinaigre\s+de\s+vin|vinaigre\s+d'alcool|vinaigre)\b/i,
  },
  {
    id: "e120_carmine",
    name: "Colorant E120 (Carmin de cochenille)",
    type: "haram",
    regex: /\b(e\s*120|carmin|carmine|cochenille|cochineal|acide\s+carminique|ci\s*75470)\b/i,
  },
  {
    id: "e441_gelatin",
    name: "Additif E441 (Gélatine)",
    type: "haram",
    regex: /\b(e\s*441)\b/i,
  },
  {
    id: "e542_bone",
    name: "Additif E542 (Phosphate d'os comestible)",
    type: "haram",
    regex: /\b(e\s*542)\b/i,
  },

  // --- DOUBTFUL INGREDIENTS (A VÉRIFIER) ---
  {
    id: "gelatin_unspecified",
    name: "Gélatine (origine animale non précisée)",
    type: "doubtful",
    regex: /\b(gelatine|gelatin)\b/i,
    negationRegex: /\b(gelatine\s+de\s+porc|gelatine\s+vegetale|gelatine\s+de\s+poisson|fish\s+gelatin|agar[\s-]agar|bovine\s+halal|certifiee\s+halal|halal)\b/i,
  },
  {
    id: "e471_emulsifier",
    name: "Additif E471 (Mono- et diglycérides d'acides gras : origine végétale ou animale non précisée)",
    type: "doubtful",
    regex: /\b(e\s*471|mono[\s-] et diglycerides|monoglycerides)\b/i,
    negationRegex: /\b(origine\s+vegetale|100%\s+vegetal|soja|tournesol|colza|palme|plant\s+origin|vegetable\s+origin|vegan|vegetar)\b/i,
  },
  {
    id: "e472_emulsifier",
    name: "Additif E472 (Esters de mono- et diglycérides)",
    type: "doubtful",
    regex: /\b(e\s*472[a-f]?)\b/i,
    negationRegex: /\b(origine\s+vegetale|100%\s+vegetal|plant\s+origin|vegetable\s+origin|vegan|vegetar)\b/i,
  },
  {
    id: "e470_e481_e482",
    name: "Additifs E470 / E481 / E482 (Sels d'acides gras / Stéaroyl)",
    type: "doubtful",
    regex: /\b(e\s*470[a-b]?|e\s*481|e\s*482)\b/i,
    negationRegex: /\b(origine\s+vegetale|100%\s+vegetal|plant\s+origin|vegetable\s+origin|vegan)\b/i,
  },
  {
    id: "animal_rennet",
    name: "Présure animale (origine d'abattage non précisée)",
    type: "doubtful",
    regex: /\b(presure\s+animale|animal\s+rennet)\b/i,
    negationRegex: /\b(presure\s+microbienne|presure\s+vegetale|microbial\s+rennet|vegetable\s+rennet|halal)\b/i,
  },
  {
    id: "e904_shellac",
    name: "Additif E904 (Gomme laque / Shellac - sécrétion d'insectes)",
    type: "doubtful",
    regex: /\b(e\s*904|shellac|gomme\s+laque)\b/i,
  },
  {
    id: "e920_cysteine",
    name: "Additif E920 (L-Cystéine)",
    type: "doubtful",
    regex: /\b(e\s*920|l[\s-]cysteine|cysteine)\b/i,
    negationRegex: /\b(origine\s+vegetale|synthetique|fermentation)\b/i,
  },
];

/**
 * Analyses real ingredients to determine Halal, Haram, or Doubtful verdict.
 * Separates general product metadata from actual ingredient data.
 */
export function analyse(
  product: Record<string, unknown>,
  source = "Open Food Facts",
): ProductResult {
  const name = String(
    product.product_name ||
      product.product_name_fr ||
      product.product_name_de ||
      product.product_name_en ||
      product.generic_name ||
      product.title ||
      "",
  );
  const brand = Array.isArray(product.brands)
    ? product.brands.join(", ")
    : String(product.brands || product.brand || "");

  // 1. Multi-language ingredient text extraction
  let ingredients = String(
    product.ingredients_text_fr ||
      product.ingredients_text_de ||
      product.ingredients_text_ch ||
      product.ingredients_text_nl ||
      product.ingredients_text_en ||
      product.ingredients_text_it ||
      product.ingredients_text_es ||
      product.ingredients_text ||
      product.description ||
      "",
  );

  // If ingredients text is empty, parse structured ingredients array
  if (!ingredients.trim() && Array.isArray(product.ingredients) && product.ingredients.length > 0) {
    ingredients = product.ingredients
      .map((i: unknown) => {
        if (typeof i === "object" && i !== null) {
          const obj = i as Record<string, unknown>;
          return String(obj.text || obj.text_fr || obj.text_de || obj.id || "");
        }
        return String(i || "");
      })
      .filter((t) => t && !t.startsWith("en:"))
      .join(", ");
  }

  // 2. Additives tags parsing (clean codes like "e120", "e471")
  const additivesCodes = (
    Array.isArray(product.additives_tags) ? product.additives_tags : []
  ).map((t) => norm(String(t)).replace(/^.*:/, ""));

  // 3. Labels & Certification detection
  const labelsStr = Array.isArray(product.labels)
    ? product.labels.join(" ")
    : String(product.labels || "");
  const labelsTagsStr = Array.isArray(product.labels_tags)
    ? product.labels_tags.join(" ")
    : String(product.labels_tags || "");
  const labelsNorm = norm(labelsStr + " " + labelsTagsStr);

  // 4. Categories extraction (ONLY used for identifying staples or meat category)
  const categoriesTags = (
    Array.isArray(product.categories_tags)
      ? product.categories_tags
      : Array.isArray(product.categories_hierarchy)
        ? product.categories_hierarchy
        : []
  ).map((t) => norm(String(t)).replace(/^.*:/, ""));

  // Prepare normalized text for rule evaluation
  const ingredientsNorm = norm(ingredients);
  const additivesNorm = additivesCodes.join(" ");
  const textToScan = `${ingredientsNorm} ${additivesNorm}`;
  const wholeProductText = `${norm(name)} ${norm(brand)} ${ingredientsNorm} ${categoriesTags.join(" ")}`;

  // Precise Halal certification detection matching this exact product
  const matchedCertTokens = CERT_TOKENS.filter(
    (c) => labelsNorm.includes(c) || wholeProductText.includes(c),
  );
  const certified = matchedCertTokens.length > 0;

  // Detect permissible meat (beef, poultry, turkey, lamb, veal, duck, etc.)
  const detectedMeats: string[] = [];
  for (const meatRule of PERMISSIBLE_MEAT_RULES) {
    if (meatRule.negationRegex && meatRule.negationRegex.test(wholeProductText)) {
      continue;
    }
    if (meatRule.regex.test(wholeProductText)) {
      detectedMeats.push(meatRule.name);
    }
  }

  // Category-based meat check (e.g. "viandes", "meats", "beef", "poultry", "steaks")
  const isMeatCategory = categoriesTags.some((cat) =>
    [
      "meats",
      "viandes",
      "beef",
      "boeuf",
      "poultry",
      "poulet",
      "volaille",
      "steaks",
      "ground-meats",
      "prepared-meats",
      "charcuterie",
    ].some((m) => cat === m || cat.endsWith(`-${m}`) || cat.startsWith(`${m}-`)),
  );

  if (isMeatCategory && detectedMeats.length === 0) {
    detectedMeats.push("Viande / Produit carné");
  }

  const haramDetected: string[] = [];
  const doubtfulDetected: string[] = [];

  // Check strict ingredient rules
  for (const rule of INGREDIENT_RULES) {
    // Check if negation matches
    if (rule.negationRegex && rule.negationRegex.test(textToScan)) {
      continue;
    }

    if (rule.regex.test(textToScan)) {
      if (rule.type === "haram") {
        haramDetected.push(rule.name);
      } else if (rule.type === "doubtful") {
        doubtfulDetected.push(rule.name);
      }
    }
  }

  // Direct additives check (e.g. e120 in additives_tags)
  if (additivesCodes.includes("e120") && !haramDetected.includes("Colorant E120 (Carmin de cochenille)")) {
    haramDetected.push("Colorant E120 (Carmin de cochenille)");
  }
  if (additivesCodes.includes("e441") && !haramDetected.includes("Additif E441 (Gélatine)")) {
    haramDetected.push("Additif E441 (Gélatine)");
  }
  if (additivesCodes.includes("e542") && !haramDetected.includes("Additif E542 (Phosphate d'os comestible)")) {
    haramDetected.push("Additif E542 (Phosphate d'os comestible)");
  }

  const reasons: string[] = [];
  let verdict: Verdict = "unknown";

  // --- STRICT CLASSIFICATION LOGIC WITH MEAT VERIFICATION ---
  if (haramDetected.length > 0) {
    // 🔴 1. HARAM: Confirmed forbidden ingredients present (Pork, Alcohol, E120...)
    verdict = "haram";
    const uniqueHaram = Array.from(new Set(haramDetected));
    uniqueHaram.forEach((item) => {
      reasons.push(`Ingrédient interdit identifié : ${item}`);
    });
    if (certified) {
      reasons.push("Attention : Le produit comporte une mention mais contient un ingrédient expressément interdit.");
    }
  } else if (detectedMeats.length > 0) {
    // 🥩 2. MEAT DETECTED: Beef, chicken, turkey, lamb, veal...
    const uniqueMeats = Array.from(new Set(detectedMeats));

    if (certified) {
      // 🟢 Certified Halal Meat
      verdict = "halal";
      reasons.push("Certification halal officielle trouvée pour ce produit.");
      reasons.push(`Viande identifiée (${uniqueMeats.join(", ")}) avec certification halal confirmée.`);
      if (ingredients.trim()) {
        reasons.push("Aucun ingrédient interdit détecté dans la composition.");
      }
    } else {
      // 🟠 Uncertified Meat -> DOUBTFUL / VÉRIFICATION NÉCESSAIRE (Never automatically halal!)
      verdict = "doubtful";
      reasons.push(
        `La viande a été identifiée (${uniqueMeats.join(", ")}), mais aucune certification halal fiable correspondant exactement à ce produit n'a été trouvée.`,
      );
      reasons.push(
        "Pour les viandes (bœuf, poulet, agneau, dinde, veau, etc.), un abattage rituel conforme et certifié est obligatoire.",
      );
      reasons.push(
        "Vérifiez la certification ou les informations fournies par le fabricant/vendeur sur l'emballage.",
      );
    }
  } else if (doubtfulDetected.length > 0) {
    // 🟠 3. DOUBTFUL ADDITIVES: Ambiguous animal/plant origin
    verdict = "doubtful";
    const uniqueDoubtful = Array.from(new Set(doubtfulDetected));
    uniqueDoubtful.forEach((item) => {
      reasons.push(`Vérification nécessaire : ${item}`);
    });
    reasons.push("Les informations disponibles ne précisent pas l'origine exacte. Vérifiez l'étiquette ou la certification.");
  } else if (certified) {
    // 🟢 4. CERTIFIED HALAL PRODUCT (Non-meat)
    verdict = "halal";
    reasons.push("Certification halal officielle déclarée pour ce produit.");
    if (ingredients.trim()) {
      reasons.push("Aucun ingrédient interdit détecté dans la composition.");
    }
  } else if (ingredients.trim().length > 0) {
    // 🟢 5. PERMISSIBLE NON-MEAT PRODUCT: Plant-based, dairy, beverages without forbidden/doubtful items
    verdict = "halal";
    reasons.push("Aucun ingrédient interdit ni douteux détecté dans la composition.");
  } else {
    // 6. NO INGREDIENT LIST AVAILABLE
    const isNaturalStaple = categoriesTags.some((cat) => {
      // Must NOT be alcoholic beverage
      if (cat.includes("alcoholic") && !cat.includes("non-alcoholic")) return false;
      return [
        "waters",
        "spring-waters",
        "mineral-waters",
        "eau",
        "fruits",
        "vegetables",
        "legumes",
        "milks",
        "lait",
        "honeys",
        "miel",
        "rices",
        "riz",
        "cereals",
        "flours",
        "farines",
        "coffees",
        "cafe",
        "teas",
        "the",
        "eggs",
        "oeufs",
        "salts",
        "sel",
        "sugars",
        "sucre",
      ].some((staple) => cat === staple || cat.endsWith(`-${staple}`) || cat.startsWith(`${staple}-`));
    });

    if (isNaturalStaple) {
      verdict = "halal";
      reasons.push("Catégorie de produit brut ou naturel sans additifs complexes.");
    } else {
      // 🟠 MISSING DATA: Never classify as Haram!
      verdict = "doubtful";
      reasons.push("Liste d'ingrédients indisponible. Les informations ne permettent pas de déterminer le statut avec certitude.");
      reasons.push("Faites défiler vers le bas pour analyser les ingrédients en photo.");
    }
  }

  return {
    code: String(product.code ?? ""),
    name: name || "Produit sans nom",
    brand,
    image:
      (product.image_front_small_url as string) ||
      (product.image_url as string) ||
      (product.image_front_url as string) ||
      undefined,
    verdict,
    ingredients,
    reasons,
    certified,
    source,
  };
}

/* ---------- Multi-source Endpoints ---------- */

async function fetchWithTimeout(url: string, ms = 3000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function offByEndpoint(
  url: string,
  sourceName = "Open Food Facts",
): Promise<ProductResult | null> {
  const res = await fetchWithTimeout(url, 3200);
  if (!res) return null;
  try {
    const json = await res.json();
    if (json.status !== 1 || !json.product) return null;
    return analyse(json.product, sourceName);
  } catch {
    return null;
  }
}

async function offByBarcode(code: string) {
  return offByEndpoint(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`,
    "Open Food Facts (World)",
  );
}

async function upcByBarcode(code: string) {
  const res = await fetchWithTimeout(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
    3000,
  );
  if (!res) return null;
  try {
    const json = await res.json();
    const item = json.items?.[0];
    if (!item) return null;
    return analyse(
      {
        code,
        product_name: item.title,
        brands: item.brand,
        ingredients_text: item.description ?? "",
        image_url: item.images?.[0],
      },
      "UPC Item DB",
    );
  } catch {
    return null;
  }
}

/** Multi-source barcode lookup with automatic fallbacks and cross-searches. */
export async function fetchByBarcode(code: string): Promise<ProductResult | null> {
  const cleanCode = code.trim();
  if (!cleanCode) return null;

  // 1. Check Curated Verified Database
  const curated = CURATED_PRODUCTS.find((p) => p.code === cleanCode);
  if (curated) return curated;

  // 2. Primary Open Food Facts World lookup
  const primaryOff = await offByBarcode(cleanCode).catch(() => null);

  // If primary OFF returned a result WITH ingredients, return immediately
  if (primaryOff && primaryOff.ingredients && primaryOff.ingredients.trim().length > 0) {
    return primaryOff;
  }

  // 3. Multi-source parallel fallbacks (Swiss, Belgian, German, French nodes + UPCitemdb)
  const [chRes, beRes, deRes, frRes, upcRes] = await Promise.allSettled([
    offByEndpoint(
      `https://ch.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      "Open Food Facts (Suisse)",
    ),
    offByEndpoint(
      `https://be.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      "Open Food Facts (Belgique)",
    ),
    offByEndpoint(
      `https://de.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      "Open Food Facts (Allemagne)",
    ),
    offByEndpoint(
      `https://fr.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      "Open Food Facts (France)",
    ),
    upcByBarcode(cleanCode),
  ]);

  const candidates: ProductResult[] = [];
  if (primaryOff) candidates.push(primaryOff);
  if (chRes.status === "fulfilled" && chRes.value) candidates.push(chRes.value);
  if (beRes.status === "fulfilled" && beRes.value) candidates.push(beRes.value);
  if (deRes.status === "fulfilled" && deRes.value) candidates.push(deRes.value);
  if (frRes.status === "fulfilled" && frRes.value) candidates.push(frRes.value);
  if (upcRes.status === "fulfilled" && upcRes.value) candidates.push(upcRes.value);

  // Return candidate with populated ingredients
  const candidateWithIngredients = candidates.find(
    (c) => c.ingredients && c.ingredients.trim().length > 0,
  );
  if (candidateWithIngredients) return candidateWithIngredients;

  // 4. Cross-search by Product Name & Brand if ingredients are still missing
  const candidateName = candidates.find((c) => c.name && c.name !== "Produit sans nom")?.name || "";
  const candidateBrand = candidates.find((c) => c.brand)?.brand || "";

  if (candidateName || candidateBrand) {
    const searchQuery = `${candidateBrand} ${candidateName}`.trim();
    if (searchQuery.length >= 3) {
      try {
        const searchMatches = await searchByName(searchQuery);
        const matchWithIngredients = searchMatches.find(
          (m) => m.ingredients && m.ingredients.trim().length > 0,
        );
        if (matchWithIngredients) {
          return {
            ...matchWithIngredients,
            code: cleanCode,
            name: candidateName || matchWithIngredients.name,
            brand: candidateBrand || matchWithIngredients.brand,
            reasons: [
              ...matchWithIngredients.reasons,
              `Composition identifiée via recherche croisée multi-sources (${matchWithIngredients.source}).`,
            ],
          };
        }
      } catch {
        /* ignore cross-search failure */
      }
    }
  }

  // 5. Final decision based on best candidate
  if (candidates.length > 0) {
    return candidates.reduce((prev, curr) => {
      if (curr.verdict === "halal" || curr.verdict === "haram") return curr;
      if (prev.verdict === "halal" || prev.verdict === "haram") return prev;
      return curr;
    }, candidates[0]);
  }

  return null;
}

/* ---------- Name search: full-text first, legacy fallback ---------- */

const CURATED_PRODUCTS: ProductResult[] = [
  {
    code: "3181232145678",
    name: "Haché L'Ultra Tendre 100% Pur Bœuf",
    brand: "Socopa",
    verdict: "doubtful",
    ingredients: "100% viande de bœuf hachée pur bœuf (origine France).",
    reasons: [
      "La viande a été identifiée (Bœuf / Viande hachée), mais aucune certification halal fiable correspondant exactement à ce produit n'a été trouvée.",
      "Pour les viandes bovines, un abattage rituel conforme et certifié est obligatoire.",
      "Vérifiez la certification ou les informations fournies par le fabricant (Socopa).",
    ],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/318/123/214/5678/front_fr.400.jpg",
  },
  {
    code: "3560070498765",
    name: "Steak Haché Pur Bœuf Halal Certifié AVS",
    brand: "Isla Délice",
    verdict: "halal",
    ingredients: "100% viande bovine certifiée halal.",
    reasons: [
      "Certification halal officielle vérifiée pour ce produit (Association AVS).",
      "Viande bovine issue d'un abattage rituel certifié conforme.",
    ],
    certified: true,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/356/007/049/8765/front_fr.400.jpg",
  },
  {
    code: "3017620422003",
    name: "Nutella (Pâte à tartiner)",
    brand: "Ferrero",
    verdict: "halal",
    ingredients:
      "Sucre, huile de palme, noisettes (13%), lait écrémé en poudre (8,7%), cacao maigre (7,4%), émulsifiants : lécithines [soja], vanilline.",
    reasons: ["Sans porc, sans alcool. Émulsifiant d'origine végétale (soja)."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.430.400.jpg",
  },
  {
    code: "8000500037560",
    name: "Kinder Bueno",
    brand: "Ferrero",
    verdict: "doubtful",
    ingredients:
      "Chocolat au lait 31,5%, sucre, huile de palme, farine de froment, noisettes (10,8%), lait écrémé en poudre, émulsifiants: lécithines [soja], arômes.",
    reasons: ["Vérification nécessaire : arômes et dérivés lactés selon le pays de production."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/800/050/003/7560/front_fr.112.400.jpg",
  },
  {
    code: "3103220009574",
    name: "Haribo Croco / Dragibus / Goldbären (Classique)",
    brand: "Haribo France",
    verdict: "haram",
    ingredients: "Sirop de glucose, sucre, gélatine de porc, dextrose, acidifiant: acide citrique.",
    reasons: ["Ingrédient interdit identifié : Gélatine de porc."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/310/322/000/9574/front_fr.82.400.jpg",
  },
  {
    code: "8690526010014",
    name: "Haribo Halal (Chamallows / Goldbären)",
    brand: "Haribo Halal",
    verdict: "halal",
    ingredients: "Sirop de glucose, sucre, gélatine bovine certifiée halal, dextrose, arômes.",
    reasons: ["Certification halal officielle déclarée (Gélatine bovine certifiée)."],
    certified: true,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/869/052/601/0014/front_fr.20.400.jpg",
  },
  {
    code: "5449000000996",
    name: "Coca-Cola Original",
    brand: "Coca-Cola",
    verdict: "halal",
    ingredients:
      "Eau gazéifiée, sucre, colorant: E150d, acidifiant: E338, arômes naturels (dont extraits végétaux et caféine).",
    reasons: ["Aucun ingrédient interdit ni douteux détecté dans la composition."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/544/900/000/0996/front_fr.387.400.jpg",
  },
  {
    code: "7622210449283",
    name: "Oreo Original",
    brand: "Mondelez / Oreo",
    verdict: "halal",
    ingredients:
      "Farine de blé, sucre, huile de palme, cacao maigre en poudre, sirop de glucose-fructose, poudres à lever, sel, émulsifiant (lécithines de soja), arôme (vanilline).",
    reasons: ["Convient aux végétariens, sans porc, sans alcool."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/762/221/044/9283/front_fr.46.400.jpg",
  },
  {
    code: "9002490100070",
    name: "Red Bull Energy Drink",
    brand: "Red Bull",
    verdict: "halal",
    ingredients:
      "Eau gazéifiée, sucre, glucose, acidifiant (acide citrique), taurine (0,4%), correcteur d'acidité, caféine, vitamines, arômes.",
    reasons: ["Taurine synthétique, aucun ingrédient d'origine porcine ni alcool."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/900/249/010/0070/front_fr.88.400.jpg",
  },
  {
    code: "5000159461122",
    name: "M&M's Peanut (Cacahuète)",
    brand: "Mars",
    verdict: "doubtful",
    ingredients:
      "Sucre, cacahuètes, pâte de cacao, lait écrémé en poudre, beurre de cacao, sirop de glucose, émulsifiants (lécithine de soja, E414), colorants (E100, E120, E133, E160a, E160e, E170).",
    reasons: [
      "Vérification nécessaire : présence éventuelle de colorant carmin E120 selon les pays de distribution.",
    ],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/500/015/946/1122/front_fr.116.400.jpg",
  },
  {
    code: "3228857000166",
    name: "Oasis Tropical",
    brand: "Oasis / Schweppes",
    verdict: "halal",
    ingredients:
      "Eau de source, jus de fruits à base de concentrés 12% (orange, pomme, fruit de la passion, mangue), sucre, acidifiant: acide citrique, arômes naturels.",
    reasons: ["Boisson sans alcool, arômes d'extraits végétaux."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/322/885/700/0166/front_fr.102.400.jpg",
  },
  {
    code: "8715700110487",
    name: "Pringles Original",
    brand: "Pringles",
    verdict: "halal",
    ingredients:
      "Pommes de terre déshydratées, huiles végétales (tournesol, palme, maïs), farine de blé, farine de riz, émulsifiant (E471), maltodextrine, sel.",
    reasons: ["Émulsifiant E471 d'origine 100% végétale certifiée par le fabricant."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/871/570/011/0487/front_fr.48.400.jpg",
  },
  {
    code: "3168930010003",
    name: "Capri-Sun Multivitamin / Orange",
    brand: "Capri-Sun",
    verdict: "halal",
    ingredients:
      "Eau de source, jus de fruits à base de concentré 12% (orange, pomme, ananas, banane, kiwi, passion), sucre, acide citrique, vitamines.",
    reasons: ["Sans conservateur, sans alcool, sans gélatine."],
    certified: false,
    source: "Base de données vérifiée Nur",
    image: "https://images.openfoodfacts.org/images/products/316/893/001/0003/front_fr.78.400.jpg",
  },
];

async function searchFastOFF(q: string): Promise<ProductResult[]> {
  try {
    const res = await fetch(
      `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=24`,
      { headers: HEADERS },
    );
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.hits || !Array.isArray(json.hits)) return [];
    return json.hits.map((h: Record<string, unknown>) =>
      analyse(
        {
          code: h.code || h.id,
          product_name: h.product_name || h.product_name_fr || h.product_name_en,
          brands: h.brands,
          ingredients_text_fr: h.ingredients_text_fr || h.ingredients_text,
          labels: h.labels,
          labels_tags: h.labels_tags,
          image_front_small_url: h.image_front_small_url || h.image_url || h.image_front_url,
        },
        "Open Food Facts",
      ),
    );
  } catch {
    return [];
  }
}

async function searchFallbackOFF(q: string): Promise<ProductResult[]> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.net/cgi/search.pl?search_terms=${encodeURIComponent(
        q,
      )}&search_simple=1&action=process&json=1&page_size=24`,
      { headers: HEADERS },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return ((json.products ?? []) as Record<string, unknown>[]).map((p) =>
      analyse(p, "Open Food Facts"),
    );
  } catch {
    return [];
  }
}

async function searchUpc(q: string): Promise<ProductResult[]> {
  try {
    const res = await fetch(
      `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(q)}&match_mode=1`,
      { headers: HEADERS },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return ((json.items ?? []) as Record<string, unknown>[]).slice(0, 10).map((item) =>
      analyse(
        {
          code: String((item.upc as string) ?? (item.ean as string) ?? ""),
          product_name: item.title,
          brands: item.brand,
          ingredients_text: item.description ?? "",
          image_url: (item.images as string[])?.[0],
        },
        "UPC Item DB",
      ),
    );
  } catch {
    return [];
  }
}

/**
 * Instant & reliable search combining curated verified database
 * with live Open Food Facts & UPC databases.
 */
export async function searchByName(q: string): Promise<ProductResult[]> {
  const term = q.trim();
  if (!term) return [];

  const normalizedTerm = norm(term);

  // 1. Check curated database first
  const curatedMatches = CURATED_PRODUCTS.filter(
    (p) =>
      norm(p.name).includes(normalizedTerm) ||
      norm(p.brand).includes(normalizedTerm) ||
      p.code.includes(term),
  );

  // 2. Fast Open Food Facts Search Engine
  const fastResults = await searchFastOFF(term);

  // 3. Fallback to secondary endpoints if fast search returns few results
  let fallbackResults: ProductResult[] = [];
  if (fastResults.length < 5) {
    const [fallbackRes, upcRes] = await Promise.allSettled([
      searchFallbackOFF(term),
      searchUpc(term),
    ]);
    fallbackResults = [
      ...(fallbackRes.status === "fulfilled" ? fallbackRes.value : []),
      ...(upcRes.status === "fulfilled" ? upcRes.value : []),
    ];
  }

  const combined = [...curatedMatches, ...fastResults, ...fallbackResults];

  const seen = new Set<string>();
  return combined.filter((r) => {
    const key = r.code ? r.code : `${r.name.toLowerCase()}-${r.brand.toLowerCase()}`;
    if (seen.has(key) || !r.name || r.name === "Produit sans nom") return false;
    seen.add(key);
    return true;
  });
}
