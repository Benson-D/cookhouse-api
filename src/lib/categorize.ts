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

export const OVERRIDES: Array<{ phrase: string; category: string }> = [
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
  // Checked before pantry's bare "ranch" (dressing/dip), so the seasoning
  // packet doesn't get misrouted there.
  { phrase: "ranch seasoning", category: "spices" },
  // Jarred/preserved/bottled forms of an otherwise-fresh-produce word.
  { phrase: "sun-dried tomato", category: "pantry" },
  { phrase: "roasted red pepper", category: "pantry" },
  { phrase: "split pea", category: "pantry" },
  { phrase: "oyster sauce", category: "pantry" },
  { phrase: "fish sauce", category: "pantry" },
  { phrase: "ground ginger", category: "spices" },
  { phrase: "celery salt", category: "spices" },
  { phrase: "hot chocolate", category: "beverages" },
  { phrase: "ginger ale", category: "beverages" },
  { phrase: "pork rind", category: "snacks" },
  // "Apple cider" reads as non-alcoholic; bare "cider" (hard cider) moved to
  // alcohol below, and "hard seltzer" needs its own override for the same
  // reason "ranch seasoning" does — beverages' bare "seltzer" would otherwise
  // claim it.
  { phrase: "apple cider", category: "beverages" },
  { phrase: "hard seltzer", category: "alcohol" },
];

export const CATEGORIES: Record<string, string[]> = {
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
    "mandarin", "blackcurrant", "redcurrant", "gooseberry", "boysenberry",
    "persimmon", "plantain", "yam", "radicchio", "endive", "arugula",
    "bok choy", "collard greens", "chard", "watercress", "jicama",
    "kohlrabi", "chayote", "taro", "cassava", "horseradish", "poblano",
    "serrano", "habanero", "lychee", "rambutan", "jackfruit", "quince",
    "currant",
  ],
  dairy: [
    "milk", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "brie",
    "gouda", "yogurt", "yoghurt", "butter", "cream", "sour cream",
    "cottage cheese", "ricotta", "half and half", "buttermilk", "ghee", "egg",
    "swiss cheese", "provolone", "monterey jack", "pepper jack",
    "string cheese", "cream cheese", "heavy cream", "kefir", "custard",
    "creme fraiche", "blue cheese", "gruyere", "camembert", "asiago",
    "condensed milk", "evaporated milk", "yakult", "probiotic drink",
    "mascarpone", "paneer", "halloumi", "queso fresco", "cotija",
    "manchego", "quark", "labneh",
  ],
  meat: [
    "chicken", "beef", "pork", "turkey", "lamb", "bacon", "sausage", "ham",
    "steak", "ground beef", "mince", "pancetta", "salami", "pepperoni",
    "hot dog", "meatball", "veal", "duck",
    "fish", "salmon", "tuna", "shrimp", "prawn", "crab", "lobster", "cod",
    "tilapia", "scallop", "seafood", "anchovy", "sardine",
    "chorizo", "bratwurst", "brisket", "rib", "venison", "bison", "rabbit",
    "quail", "mussel", "clam", "oyster", "squid", "calamari", "octopus",
    "trout", "mackerel", "halibut", "bass", "catfish", "snapper",
    "mahi mahi",
  ],
  bakery: [
    "bread", "bagel", "tortilla", "roll", "bun", "baguette", "croissant",
    "muffin", "pita", "naan", "pastry", "pie crust", "biscuit",
    "brioche", "ciabatta", "focaccia", "breadstick", "flatbread",
    "pizza dough", "scone", "danish",
  ],
  pantry: [
    "rice", "pasta", "noodle", "flour", "sugar", "oil", "vinegar", "sauce",
    "broth", "stock", "bean", "lentil", "chickpea", "canned", "soup",
    "cereal", "oat", "oats", "honey", "syrup", "jam", "jelly", "nut butter",
    "tofu", "tahini", "quinoa", "breadcrumb", "stuffing", "gravy", "ketchup",
    "mustard", "mayonnaise", "mayo", "salsa", "cocoa", "yeast", "cornstarch",
    "coconut", "dried fruit", "pickle", "olive", "couscous", "ranch",
    "barley", "bulgur", "farro", "polenta", "cornmeal", "panko",
    "applesauce", "vegetable oil", "canola oil", "worcestershire sauce",
    "hot sauce", "bbq sauce", "teriyaki sauce", "hoisin sauce", "relish",
    "caper", "tamari",
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
    "sumac", "za'atar", "herbs de provence",
    "pumpkin spice", "chipotle powder", "onion flakes", "garlic flakes", "msg",
    "peppercorn", "harissa", "gochugaru", "wasabi",
  ],
  frozen: [
    "frozen", "popsicle", "frozen pizza", "frozen vegetable", "frozen fruit",
    "frozen meal", "waffle", "fish stick",
    "sorbet", "ice pop", "hash brown", "tater tot",
  ],
  snacks: [
    "chip", "pretzel", "popcorn", "cracker", "nut", "almond", "walnut",
    "pecan", "cashew", "pistachio", "hazelnut", "granola bar", "protein bar",
    "trail mix", "candy bar", "jerky", "rice cake",
    "chestnut", "gummy", "fruit snack",
  ],
  beverages: [
    "water", "soda", "juice", "coffee", "tea", "kombucha",
    "sparkling water", "lemonade", "energy drink", "coke", "cola",
    "sprite", "rc", "dr pepper", "pepsi",
    "gatorade", "sports drink", "seltzer", "club soda", "tonic water",
    "root beer",
  ],
  desserts: [
    "chocolate", "cookie", "cake", "brownie", "candy", "pie", "pudding",
    "donut", "doughnut", "cupcake", "marshmallow", "sweet",
    "gelatin", "tart", "macaron", "fudge", "toffee", "caramel",
  ],
  alcohol: [
    "beer", "wine", "cider", "vodka", "whiskey", "whisky", "rum", "tequila",
    "gin", "brandy", "champagne", "prosecco", "sake", "mezcal", "bourbon",
    "scotch", "ale", "lager", "stout", "ipa", "malt liquor", "liqueur",
  ],
  household: [
    "soap", "detergent", "paper towel", "toilet paper", "shampoo",
    "conditioner", "toothpaste", "deodorant", "dish soap",
    "laundry detergent", "bleach", "trash bag", "paper plate", "napkin",
    "tissue", "hand sanitizer", "sponge", "aluminum foil", "plastic wrap",
    "ziploc bag", "lightbulb", "battery", "candle", "air freshener",
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A trailing consonant + "y" pluralizes as "-ies" ("blueberry" ->
 * "blueberries"), not a simple "+s"/"+es" suffix — "blueberrys" isn't a real
 * word. Every other keyword just gets an optional "s"/"es" tacked on.
 */
function keywordPattern(keyword: string): RegExp {
  if (/[^aeiou]y$/i.test(keyword)) {
    const stem = escapeRegExp(keyword.slice(0, -1));
    return new RegExp(`\\b${stem}(y|ies)\\b`, "i");
  }
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
