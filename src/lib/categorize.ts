/**
 * Guesses a grocery category for a new ingredient name, from a static
 * keyword dictionary — no AI, no external call. Returns `null` rather than
 * guessing when nothing matches confidently (garbled OCR text like
 * "GV WHL MLK" is expected to fall through to null, not a wrong category).
 *
 * Checked in two passes: compound-phrase overrides first (so "almond milk"
 * resolves to beverages before the generic "milk" keyword would otherwise
 * claim it for dairy), then each category's keyword list. A keyword matches
 * its plain form or a simple "s"/"es" plural — never the reverse (stripping
 * letters off the input would break words that already end in "s", like
 * "asparagus" or "hummus").
 */

const OVERRIDES: Array<{ phrase: string; category: string }> = [
  { phrase: "almond milk", category: "beverages" },
  { phrase: "oat milk", category: "beverages" },
  { phrase: "soy milk", category: "beverages" },
  { phrase: "cashew milk", category: "beverages" },
  { phrase: "coconut water", category: "beverages" },
  { phrase: "coconut milk", category: "pantry" },
  { phrase: "coconut oil", category: "pantry" },
  { phrase: "coconut flour", category: "pantry" },
  { phrase: "coconut sugar", category: "pantry" },
  { phrase: "peanut butter", category: "pantry" },
  { phrase: "almond butter", category: "pantry" },
  { phrase: "cashew butter", category: "pantry" },
  { phrase: "peanut oil", category: "pantry" },
  { phrase: "green bean", category: "produce" },
  { phrase: "chicken broth", category: "pantry" },
  { phrase: "chicken stock", category: "pantry" },
  { phrase: "beef broth", category: "pantry" },
  { phrase: "beef stock", category: "pantry" },
  { phrase: "vegetable broth", category: "pantry" },
  { phrase: "bone broth", category: "pantry" },
  { phrase: "tomato sauce", category: "pantry" },
  { phrase: "tomato paste", category: "pantry" },
  { phrase: "ice cream", category: "frozen" },
  { phrase: "frozen yogurt", category: "frozen" },
  { phrase: "frozen yoghurt", category: "frozen" },
  // Seed/powder forms of an otherwise-produce or otherwise-pantry word —
  // checked here so "coriander seed" resolves to spices, not produce's bare
  // "coriander" (fresh cilantro) or pantry's bare "mustard" (the condiment).
  { phrase: "coriander seed", category: "spices" },
  { phrase: "fennel seed", category: "spices" },
  { phrase: "mustard seed", category: "spices" },
  { phrase: "mustard powder", category: "spices" },
];

const CATEGORIES: Record<string, string[]> = {
  produce: [
    "banana", "apple", "orange", "grape", "strawberry", "blueberry", "raspberry",
    "blackberry", "melon", "watermelon", "cantaloupe", "pineapple", "mango",
    "peach", "pear", "plum", "cherry", "kiwi", "fig", "date", "apricot",
    "lemon", "lime", "avocado", "tomato", "potato", "sweet potato", "onion",
    "garlic", "ginger", "carrot", "celery", "broccoli", "cauliflower",
    "spinach", "kale", "lettuce", "cabbage", "cucumber", "zucchini", "squash",
    "pumpkin", "pepper", "bell pepper", "jalapeno", "mushroom", "corn", "pea",
    "asparagus", "eggplant", "aubergine", "beet", "beetroot", "radish",
    "scallion", "spring onion", "shallot", "leek", "artichoke", "okra",
    "basil", "cilantro", "coriander", "parsley", "mint", "dill", "chive",
    "nectarine", "papaya", "guava", "pomegranate", "tangerine", "clementine",
    "grapefruit", "passion fruit", "star fruit", "honeydew", "dragon fruit",
    "parsnip", "turnip", "rutabaga", "brussels sprout", "fennel",
  ],
  dairy: [
    "milk", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "brie",
    "gouda", "yogurt", "yoghurt", "butter", "cream", "sour cream",
    "cottage cheese", "ricotta", "half and half", "buttermilk", "ghee", "egg",
    "swiss cheese", "provolone", "monterey jack", "pepper jack",
    "string cheese", "cream cheese", "heavy cream", "kefir", "custard",
    "creme fraiche", "blue cheese", "gruyere", "camembert", "asiago",
    "condensed milk", "evaporated milk",
  ],
  meat: [
    "chicken", "beef", "pork", "turkey", "lamb", "bacon", "sausage", "ham",
    "steak", "ground beef", "mince", "pancetta", "salami", "pepperoni",
    "hot dog", "meatball", "veal", "duck",
    "fish", "salmon", "tuna", "shrimp", "prawn", "crab", "lobster", "cod",
    "tilapia", "scallop", "seafood", "anchovy", "sardine",
  ],
  bakery: [
    "bread", "bagel", "tortilla", "roll", "bun", "baguette", "croissant",
    "muffin", "pita", "naan", "pastry", "pie crust", "biscuit",
  ],
  pantry: [
    "rice", "pasta", "noodle", "flour", "sugar", "oil", "vinegar", "sauce",
    "broth", "stock", "bean", "lentil", "chickpea", "canned", "soup",
    "cereal", "oat", "oats", "honey", "syrup", "jam", "jelly", "nut butter",
    "tofu", "tahini", "quinoa", "breadcrumb", "stuffing", "gravy", "ketchup",
    "mustard", "mayonnaise", "mayo", "salsa", "cocoa", "yeast", "cornstarch",
    "coconut", "dried fruit", "pickle", "olive",
  ],
  spices: [
    "salt", "black pepper", "cumin", "paprika", "turmeric", "cinnamon",
    "nutmeg", "cardamom", "clove", "cayenne", "chili powder", "chilli powder",
    "curry powder", "garam masala", "oregano", "thyme", "rosemary", "sage",
    "bay leaf", "allspice", "saffron", "vanilla extract", "baking powder",
    "baking soda", "garlic powder", "onion powder", "italian seasoning",
    "red pepper flake", "cajun seasoning", "chili flake", "star anise",
    "five spice", "white pepper", "poultry seasoning", "taco seasoning",
    "everything bagel seasoning", "adobo seasoning", "seasoning salt",
    "ranch seasoning", "sumac", "za'atar", "herbs de provence",
    "pumpkin spice", "chipotle powder", "onion flakes", "garlic flakes", "msg",
  ],
  frozen: [
    "frozen", "popsicle", "frozen pizza", "frozen vegetable", "frozen fruit",
    "frozen meal", "waffle", "fish stick",
  ],
  snacks: [
    "chip", "pretzel", "popcorn", "cracker", "nut", "almond", "walnut",
    "pecan", "cashew", "pistachio", "hazelnut", "granola bar", "protein bar",
    "trail mix", "candy bar", "jerky", "rice cake",
  ],
  beverages: [
    "water", "soda", "juice", "coffee", "tea", "kombucha", "beer", "wine",
    "sparkling water", "lemonade", "energy drink", "cider",
  ],
  desserts: [
    "chocolate", "cookie", "cake", "brownie", "candy", "pie", "pudding",
    "donut", "doughnut", "cupcake", "marshmallow", "sweet",
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `keyword` as a whole word, allowing a trailing "s" or "es". */
function keywordPattern(keyword: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(keyword)}(e?s)?\\b`, "i");
}

/**
 * Best-effort category guess for a brand-new ingredient name. Returns
 * `null` when nothing matches — that's the correct, honest result for
 * unrecognized or garbled input, not a bug to fix by guessing harder.
 */
export function categorize(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  for (const { phrase, category } of OVERRIDES) {
    if (normalized.includes(phrase)) {
      return category;
    }
  }

  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some((keyword) => keywordPattern(keyword).test(normalized))) {
      return category;
    }
  }

  return null;
}
