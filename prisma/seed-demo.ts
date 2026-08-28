import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { addFromRecipes } from "../src/modules/grocery-lists/grocery-lists.service.js";

/**
 * Demo fixtures for local development — recipes, staples, a grocery list and
 * six months of purchases belonging to one real Clerk household.
 *
 * Deliberately NOT wired into `prisma db seed`. That command runs
 * automatically after `prisma migrate reset` and against whatever database is
 * configured, so anything registered there can land in a shared database
 * unasked. Reference data (units, tags) belongs in `seed.ts`; this file is the
 * throwaway half and must be invoked by hand via `pnpm db:seed:demo`.
 *
 * Every row it owns carries a `demo-` id prefix, so re-running wipes only its
 * own fixtures and never a recipe you typed in yourself, and
 * `pnpm db:seed:demo:clean` removes them all without writing anything back.
 * The exception is `Ingredient`, which is global and shared by every
 * household — those are upserted by name and never deleted.
 *
 * Household data keys on `clerkOrgId`, which is not a local FK, so fixtures
 * created against an invented id are invisible to every signed-in user. Both
 * ids are therefore required from the environment rather than defaulted.
 *
 * The recipe set is sized and tagged for exercising the frontend: 24 recipes
 * against a default page size of 20 forces pagination, every seeded tag has at
 * least two recipes so filter chips return something, and cooking times spread
 * from 5 to 180 minutes so the `maxCookingTime` filter has a real range.
 */

const DEMO_PREFIX = "demo-";
const CLEAN_ONLY = process.argv.includes("--clean");

const clerkOrgId = process.env.DEMO_CLERK_ORG_ID;
const clerkUserId = process.env.DEMO_CLERK_USER_ID;

/** Ingredients are global rows shared across households — upserted, never deleted. */
const ingredients: Array<{ name: string; category: string }> = [
  { name: "flour", category: "pantry" },
  { name: "butter", category: "dairy" },
  { name: "sugar", category: "pantry" },
  { name: "eggs", category: "dairy" },
  { name: "milk", category: "dairy" },
  { name: "parmesan", category: "dairy" },
  { name: "spaghetti", category: "pantry" },
  { name: "pancetta", category: "meat" },
  { name: "black pepper", category: "pantry" },
  { name: "olive oil", category: "pantry" },
  { name: "garlic", category: "produce" },
  { name: "chicken thighs", category: "meat" },
  { name: "coconut milk", category: "pantry" },
  { name: "red curry paste", category: "pantry" },
  { name: "basmati rice", category: "pantry" },
  { name: "tomatoes", category: "produce" },
  { name: "onion", category: "produce" },
  { name: "carrot", category: "produce" },
  { name: "potatoes", category: "produce" },
  { name: "beef mince", category: "meat" },
  { name: "tortillas", category: "bakery" },
  { name: "black beans", category: "pantry" },
  { name: "cheddar", category: "dairy" },
  { name: "lime", category: "produce" },
  { name: "coriander", category: "produce" },
  { name: "cumin", category: "pantry" },
  { name: "smoked paprika", category: "pantry" },
  { name: "soy sauce", category: "pantry" },
  { name: "ginger", category: "produce" },
  { name: "sesame oil", category: "pantry" },
  { name: "spring onions", category: "produce" },
  { name: "tofu", category: "chilled" },
  { name: "rice vinegar", category: "pantry" },
  { name: "sushi rice", category: "pantry" },
  { name: "salmon", category: "fish" },
  { name: "chickpeas", category: "pantry" },
  { name: "tahini", category: "pantry" },
  { name: "lemon", category: "produce" },
  { name: "cucumber", category: "produce" },
  { name: "feta", category: "dairy" },
  { name: "olives", category: "pantry" },
  { name: "bell pepper", category: "produce" },
  { name: "mushrooms", category: "produce" },
  { name: "double cream", category: "dairy" },
  { name: "bacon", category: "meat" },
  { name: "sourdough bread", category: "bakery" },
  { name: "avocado", category: "produce" },
  { name: "banana", category: "produce" },
  { name: "rolled oats", category: "pantry" },
  { name: "honey", category: "pantry" },
  { name: "almonds", category: "pantry" },
  { name: "dark chocolate", category: "pantry" },
  { name: "vanilla extract", category: "pantry" },
  { name: "baking powder", category: "pantry" },
  { name: "salt", category: "pantry" },
  { name: "mozzarella", category: "dairy" },
  { name: "basil", category: "produce" },
  { name: "pine nuts", category: "pantry" },
  { name: "aubergine", category: "produce" },
  { name: "red lentils", category: "pantry" },
  { name: "spinach", category: "produce" },
  { name: "yoghurt", category: "dairy" },
  { name: "curry powder", category: "pantry" },
  { name: "peanut butter", category: "pantry" },
  { name: "egg noodles", category: "pantry" },
  { name: "prawns", category: "fish" },
  { name: "maple syrup", category: "pantry" },
  { name: "apples", category: "produce" },
  { name: "cinnamon", category: "pantry" },
  { name: "puff pastry", category: "chilled" },
  { name: "bread", category: "bakery" },
  { name: "jelly", category: "pantry" },
];

type DemoLine = { ingredient: string; unit: string | null; amount: number | null; notes?: string };

type DemoRecipe = {
  slug: string;
  name: string;
  description: string;
  servings: number;
  prepTime: number;
  cookingTime: number;
  tags: string[];
  lines: DemoLine[];
  steps: Array<{ text: string; timerSeconds?: number }>;
  /** Favorited by the demo user, so `favoritesOnly` has something to filter to. */
  favorite?: boolean;
};

/** Terse helper — the shape above is mostly noise when repeated 24 times. */
const line = (ingredient: string, amount: number | null, unit: string | null, notes?: string): DemoLine => ({
  ingredient,
  amount,
  unit,
  notes,
});

/**
 * Pancakes measure flour in cups and shortbread measures it in grams, on
 * purpose. Adding both to one list is the case the domain rules turn on:
 * volume and weight cannot be summed without per-ingredient density, so the
 * merged list shows a single "flour" line with no number at all — not two
 * rows, and not a fabricated total. Butter (50 g + 250 g) and eggs merge
 * normally alongside it, so a correct list shows both behaviours at once.
 */
const recipes: DemoRecipe[] = [
  {
    slug: "carbonara",
    name: "Spaghetti Carbonara",
    description: "Pancetta, egg and parmesan — no cream.",
    servings: 4,
    prepTime: 10,
    cookingTime: 15,
    tags: ["italian", "dinner"],
    favorite: true,
    lines: [
      line("spaghetti", 400, "gram"),
      line("pancetta", 150, "gram", "diced"),
      line("eggs", 4, "piece"),
      line("parmesan", 50, "gram", "finely grated"),
      line("black pepper", null, null, "to taste"),
    ],
    steps: [
      { text: "Boil the spaghetti in well-salted water until al dente.", timerSeconds: 600 },
      { text: "Render the pancetta in a dry pan until crisp." },
      { text: "Beat the eggs with the parmesan and plenty of black pepper." },
      { text: "Toss the drained pasta off the heat with the pancetta, then the egg mixture." },
    ],
  },
  {
    slug: "pancakes",
    name: "Buttermilk Pancakes",
    description: "Weekend breakfast stack.",
    servings: 4,
    prepTime: 10,
    cookingTime: 20,
    tags: ["breakfast", "american"],
    lines: [
      line("flour", 2, "cup"),
      line("milk", 300, "milliliter"),
      line("eggs", 2, "piece"),
      line("butter", 50, "gram", "melted"),
      line("sugar", 2, "tablespoon"),
    ],
    steps: [
      { text: "Whisk the dry ingredients together." },
      { text: "Beat in the milk, eggs and melted butter until just combined." },
      { text: "Rest the batter before cooking.", timerSeconds: 900 },
      { text: "Cook on a medium griddle until bubbles set, then flip." },
    ],
  },
  {
    slug: "shortbread",
    name: "Scottish Shortbread",
    description: "Three ingredients, weighed not measured.",
    servings: 12,
    prepTime: 15,
    cookingTime: 45,
    tags: ["dessert"],
    lines: [
      line("flour", 500, "gram"),
      line("butter", 250, "gram", "cold, cubed"),
      line("sugar", 100, "gram"),
    ],
    steps: [
      { text: "Rub the butter into the flour and sugar until it clumps." },
      { text: "Press into a tin and dock all over with a fork." },
      { text: "Bake low and slow until pale gold.", timerSeconds: 2700 },
    ],
  },
  {
    slug: "thai-curry",
    name: "Thai Red Curry",
    description: "Weeknight curry, thirty minutes start to finish.",
    servings: 4,
    prepTime: 10,
    cookingTime: 25,
    tags: ["thai", "dinner", "dairy-free"],
    favorite: true,
    lines: [
      line("chicken thighs", 600, "gram", "sliced"),
      line("coconut milk", 400, "milliliter"),
      line("red curry paste", 3, "tablespoon"),
      line("basmati rice", 300, "gram"),
      line("garlic", 3, "piece", "crushed"),
    ],
    steps: [
      { text: "Fry the curry paste in a little oil until fragrant." },
      { text: "Add the chicken and colour it on all sides." },
      { text: "Pour in the coconut milk and simmer.", timerSeconds: 1200 },
      { text: "Serve over steamed basmati." },
    ],
  },
  {
    slug: "beef-tacos",
    name: "Weeknight Beef Tacos",
    description: "Twenty minutes, one pan, everything on the table.",
    servings: 4,
    prepTime: 10,
    cookingTime: 20,
    tags: ["mexican", "dinner"],
    lines: [
      line("beef mince", 500, "gram"),
      line("tortillas", 8, "piece"),
      line("onion", 1, "piece", "finely chopped"),
      line("cumin", 2, "teaspoon"),
      line("smoked paprika", 1, "teaspoon"),
      line("cheddar", 100, "gram", "grated"),
    ],
    steps: [
      { text: "Brown the mince hard, breaking it up as it goes." },
      { text: "Add the onion and spices and cook until soft." },
      { text: "Warm the tortillas and build with cheese and lime." },
    ],
  },
  {
    slug: "black-bean-tacos",
    name: "Black Bean Tacos",
    description: "The vegan version, and arguably the better one.",
    servings: 4,
    prepTime: 10,
    cookingTime: 15,
    tags: ["mexican", "vegan", "vegetarian", "dinner", "dairy-free"],
    lines: [
      line("black beans", 400, "gram", "drained"),
      line("tortillas", 8, "piece"),
      line("avocado", 2, "piece"),
      line("lime", 1, "piece"),
      line("coriander", null, null, "a large handful"),
      line("cumin", 2, "teaspoon"),
    ],
    steps: [
      { text: "Fry the beans with the cumin until they start to catch." },
      { text: "Mash the avocado with lime and salt." },
      { text: "Build, then finish with coriander." },
    ],
  },
  {
    slug: "chicken-stir-fry",
    name: "Ginger Chicken Stir-Fry",
    description: "Faster than ordering in.",
    servings: 3,
    prepTime: 15,
    cookingTime: 10,
    tags: ["chinese", "dinner", "dairy-free"],
    lines: [
      line("chicken thighs", 500, "gram", "sliced thin"),
      line("egg noodles", 250, "gram"),
      line("soy sauce", 3, "tablespoon"),
      line("ginger", 30, "gram", "julienned"),
      line("spring onions", 4, "piece"),
      line("sesame oil", 1, "tablespoon"),
    ],
    steps: [
      { text: "Get the wok properly hot before anything goes in." },
      { text: "Sear the chicken in batches so it fries rather than steams." },
      { text: "Return everything to the pan with the sauce and toss through." },
    ],
  },
  {
    slug: "mapo-tofu",
    name: "Mapo Tofu",
    description: "Numbing, savoury, and ready in a quarter of an hour.",
    servings: 3,
    prepTime: 10,
    cookingTime: 15,
    tags: ["chinese", "vegetarian", "dinner", "dairy-free"],
    lines: [
      line("tofu", 400, "gram", "cubed"),
      line("soy sauce", 2, "tablespoon"),
      line("garlic", 3, "piece"),
      line("ginger", 20, "gram"),
      line("spring onions", 3, "piece"),
      line("basmati rice", 250, "gram"),
    ],
    steps: [
      { text: "Simmer the aromatics into a sauce." },
      { text: "Slide the tofu in and warm it through without breaking it up." },
      { text: "Finish with spring onion and serve over rice." },
    ],
  },
  {
    slug: "salmon-teriyaki",
    name: "Teriyaki Salmon",
    description: "Sticky glaze, crisp skin.",
    servings: 2,
    prepTime: 5,
    cookingTime: 15,
    tags: ["japanese", "dinner", "dairy-free"],
    favorite: true,
    lines: [
      line("salmon", 2, "piece", "skin on"),
      line("soy sauce", 4, "tablespoon"),
      line("honey", 2, "tablespoon"),
      line("ginger", 15, "gram"),
      line("sushi rice", 200, "gram"),
    ],
    steps: [
      { text: "Start the rice first — everything else is faster." },
      { text: "Sear the salmon skin-side down until it releases.", timerSeconds: 300 },
      { text: "Add the glaze and spoon it over until sticky." },
    ],
  },
  {
    slug: "cucumber-sunomono",
    name: "Cucumber Sunomono",
    description: "Five-minute pickle to go alongside anything.",
    servings: 4,
    prepTime: 5,
    cookingTime: 5,
    tags: ["japanese", "side", "vegan", "vegetarian", "gluten-free", "dairy-free"],
    lines: [
      line("cucumber", 2, "piece", "sliced paper thin"),
      line("rice vinegar", 4, "tablespoon"),
      line("sugar", 1, "tablespoon"),
      line("salt", 1, "teaspoon"),
    ],
    steps: [
      { text: "Salt the cucumber and let it weep.", timerSeconds: 600 },
      { text: "Squeeze out the water and dress with vinegar and sugar." },
    ],
  },
  {
    slug: "dal-tarka",
    name: "Red Lentil Dal",
    description: "Cheap, fast, and better the next day.",
    servings: 4,
    prepTime: 10,
    cookingTime: 35,
    tags: ["indian", "vegan", "vegetarian", "dinner", "gluten-free", "dairy-free"],
    lines: [
      line("red lentils", 300, "gram"),
      line("onion", 1, "piece"),
      line("garlic", 4, "piece"),
      line("curry powder", 2, "tablespoon"),
      line("tomatoes", 400, "gram", "tinned"),
      line("spinach", 100, "gram"),
    ],
    steps: [
      { text: "Simmer the lentils until collapsing.", timerSeconds: 1500 },
      { text: "Fry the aromatics and spices separately until fragrant." },
      { text: "Stir the tarka through the dal and wilt in the spinach." },
    ],
  },
  {
    slug: "chicken-tikka",
    name: "Chicken Tikka",
    description: "Yoghurt marinade does the work overnight.",
    servings: 4,
    prepTime: 20,
    cookingTime: 25,
    tags: ["indian", "dinner", "gluten-free"],
    lines: [
      line("chicken thighs", 800, "gram"),
      line("yoghurt", 300, "gram"),
      line("curry powder", 3, "tablespoon"),
      line("garlic", 4, "piece"),
      line("lemon", 1, "piece"),
      line("basmati rice", 300, "gram"),
    ],
    steps: [
      { text: "Marinate the chicken overnight if you can." },
      { text: "Grill hard and fast so the edges char." },
      { text: "Rest before serving with rice." },
    ],
  },
  {
    slug: "margherita",
    name: "Margherita Pizza",
    description: "Slow dough, hot oven, three toppings.",
    servings: 2,
    prepTime: 30,
    cookingTime: 12,
    tags: ["italian", "vegetarian", "dinner"],
    lines: [
      line("flour", 500, "gram", "strong white"),
      line("mozzarella", 250, "gram", "torn"),
      line("tomatoes", 400, "gram", "tinned, crushed"),
      line("basil", null, null, "a handful"),
      line("olive oil", 2, "tablespoon"),
    ],
    steps: [
      { text: "Prove the dough until doubled." },
      { text: "Heat the oven as hot as it goes with a stone in it." },
      { text: "Top sparingly and bake until blistered.", timerSeconds: 720 },
    ],
  },
  {
    slug: "pesto",
    name: "Basil Pesto",
    description: "Makes enough for a week of lunches.",
    servings: 6,
    prepTime: 10,
    cookingTime: 5,
    tags: ["italian", "vegetarian", "side", "gluten-free"],
    lines: [
      line("basil", 100, "gram"),
      line("pine nuts", 50, "gram", "toasted"),
      line("parmesan", 60, "gram"),
      line("garlic", 1, "piece"),
      line("olive oil", 150, "milliliter"),
    ],
    steps: [
      { text: "Toast the pine nuts and let them cool." },
      { text: "Pound or blitz everything, adding the oil last." },
    ],
  },
  {
    slug: "aubergine-parm",
    name: "Aubergine Parmigiana",
    description: "A Sunday project worth the washing up.",
    servings: 6,
    prepTime: 30,
    cookingTime: 60,
    tags: ["italian", "vegetarian", "dinner"],
    lines: [
      line("aubergine", 3, "piece", "sliced"),
      line("tomatoes", 800, "gram", "tinned"),
      line("mozzarella", 250, "gram"),
      line("parmesan", 80, "gram"),
      line("basil", null, null),
      line("olive oil", 100, "milliliter"),
    ],
    steps: [
      { text: "Salt and drain the aubergine, then fry in batches." },
      { text: "Reduce the tomatoes to a thick sauce.", timerSeconds: 1800 },
      { text: "Layer and bake until bubbling.", timerSeconds: 2400 },
    ],
  },
  {
    slug: "greek-salad",
    name: "Greek Salad",
    description: "No lettuce. Never lettuce.",
    servings: 4,
    prepTime: 15,
    cookingTime: 5,
    tags: ["mediterranean", "vegetarian", "side", "gluten-free"],
    lines: [
      line("tomatoes", 500, "gram", "ripe"),
      line("cucumber", 1, "piece"),
      line("feta", 200, "gram"),
      line("olives", 100, "gram"),
      line("olive oil", 4, "tablespoon"),
    ],
    steps: [
      { text: "Cut everything into rough, generous chunks." },
      { text: "Dress at the table so nothing goes soggy." },
    ],
  },
  {
    slug: "hummus",
    name: "Proper Hummus",
    description: "More tahini than you think, more lemon than that.",
    servings: 6,
    prepTime: 10,
    cookingTime: 5,
    tags: ["mediterranean", "vegan", "vegetarian", "snack", "gluten-free", "dairy-free"],
    lines: [
      line("chickpeas", 400, "gram"),
      line("tahini", 120, "gram"),
      line("lemon", 2, "piece"),
      line("garlic", 2, "piece"),
      line("olive oil", 3, "tablespoon"),
    ],
    steps: [
      { text: "Blitz the tahini with lemon and ice water until pale." },
      { text: "Add the chickpeas and run it far longer than feels sensible." },
    ],
  },
  {
    slug: "shakshuka",
    name: "Shakshuka",
    description: "Breakfast, lunch or dinner, one pan throughout.",
    servings: 3,
    prepTime: 10,
    cookingTime: 25,
    tags: ["mediterranean", "vegetarian", "breakfast", "gluten-free"],
    favorite: true,
    lines: [
      line("eggs", 6, "piece"),
      line("tomatoes", 800, "gram", "tinned"),
      line("bell pepper", 2, "piece"),
      line("onion", 1, "piece"),
      line("cumin", 2, "teaspoon"),
      line("smoked paprika", 1, "teaspoon"),
    ],
    steps: [
      { text: "Soften the peppers and onion slowly." },
      { text: "Add tomatoes and spices, reduce until thick.", timerSeconds: 900 },
      { text: "Make wells, crack in the eggs, cover until just set.", timerSeconds: 420 },
    ],
  },
  {
    slug: "mushroom-risotto",
    name: "Mushroom Risotto",
    description: "Twenty minutes of stirring, and no shortcuts.",
    servings: 4,
    prepTime: 10,
    cookingTime: 30,
    tags: ["italian", "vegetarian", "dinner", "gluten-free"],
    lines: [
      line("mushrooms", 400, "gram", "mixed"),
      line("onion", 1, "piece"),
      line("parmesan", 80, "gram"),
      line("butter", 60, "gram"),
      line("garlic", 2, "piece"),
    ],
    steps: [
      { text: "Fry the mushrooms hard and set aside." },
      { text: "Toast the rice, then add stock a ladle at a time.", timerSeconds: 1080 },
      { text: "Beat in the butter and parmesan off the heat." },
    ],
  },
  {
    slug: "full-breakfast",
    name: "Weekend Fry-Up",
    description: "Timing is the whole recipe.",
    servings: 2,
    prepTime: 5,
    cookingTime: 20,
    tags: ["american", "breakfast"],
    lines: [
      line("bacon", 6, "piece"),
      line("eggs", 4, "piece"),
      line("tomatoes", 2, "piece", "halved"),
      line("mushrooms", 150, "gram"),
      line("sourdough bread", 4, "piece"),
    ],
    steps: [
      { text: "Bacon first, and cook the rest in its fat." },
      { text: "Eggs last, so nothing waits on them." },
    ],
  },
  {
    slug: "overnight-oats",
    name: "Overnight Oats",
    description: "Assembled in two minutes the night before.",
    servings: 2,
    prepTime: 5,
    cookingTime: 5,
    tags: ["breakfast", "vegetarian", "snack"],
    lines: [
      line("rolled oats", 100, "gram"),
      line("milk", 250, "milliliter"),
      line("banana", 1, "piece"),
      line("peanut butter", 2, "tablespoon"),
      line("honey", 1, "tablespoon"),
    ],
    steps: [
      { text: "Stir everything together in a jar." },
      { text: "Refrigerate overnight and top in the morning." },
    ],
  },
  {
    slug: "banana-bread",
    name: "Banana Bread",
    description: "The blacker the bananas, the better.",
    servings: 10,
    prepTime: 15,
    cookingTime: 55,
    tags: ["dessert", "vegetarian", "snack"],
    lines: [
      line("banana", 3, "piece", "very ripe"),
      line("flour", 250, "gram"),
      line("sugar", 150, "gram"),
      line("butter", 120, "gram", "melted"),
      line("eggs", 2, "piece"),
      line("baking powder", 2, "teaspoon"),
    ],
    steps: [
      { text: "Mash the bananas to a purée." },
      { text: "Fold everything together without overworking it." },
      { text: "Bake until a skewer comes out clean.", timerSeconds: 3300 },
    ],
  },
  {
    slug: "chocolate-mousse",
    name: "Dark Chocolate Mousse",
    description: "Two ingredients if you are strict about it.",
    servings: 6,
    prepTime: 20,
    cookingTime: 10,
    tags: ["dessert", "vegetarian", "gluten-free"],
    lines: [
      line("dark chocolate", 200, "gram"),
      line("eggs", 4, "piece", "separated"),
      line("double cream", 200, "milliliter"),
      line("sugar", 50, "gram"),
      line("vanilla extract", 1, "teaspoon"),
    ],
    steps: [
      { text: "Melt the chocolate gently and let it cool slightly." },
      { text: "Whip the whites to soft peaks, then fold in thirds." },
      { text: "Chill for at least four hours." },
    ],
  },
  {
    slug: "apple-tart",
    name: "Thin Apple Tart",
    description: "Shop-bought pastry, and no apology for it.",
    servings: 8,
    prepTime: 20,
    cookingTime: 30,
    tags: ["dessert", "vegetarian", "american"],
    lines: [
      line("puff pastry", 320, "gram"),
      line("apples", 4, "piece", "sliced thin"),
      line("sugar", 60, "gram"),
      line("butter", 40, "gram"),
      line("cinnamon", 1, "teaspoon"),
    ],
    steps: [
      { text: "Score a border and dock the middle of the pastry." },
      { text: "Shingle the apples, dot with butter, dust with sugar." },
      { text: "Bake hot until the pastry is properly cooked underneath.", timerSeconds: 1800 },
    ],
  },
  {
    slug: "prawn-noodles",
    name: "Garlic Prawn Noodles",
    description: "Ten minutes, mostly boiling water.",
    servings: 2,
    prepTime: 5,
    cookingTime: 10,
    tags: ["thai", "lunch", "dairy-free"],
    lines: [
      line("prawns", 300, "gram"),
      line("egg noodles", 200, "gram"),
      line("garlic", 4, "piece"),
      line("lime", 1, "piece"),
      line("coriander", null, null),
      line("sesame oil", 1, "tablespoon"),
    ],
    steps: [
      { text: "Boil the noodles and drain." },
      { text: "Fry the garlic gently, add prawns, cook until just pink." },
      { text: "Toss with the noodles and finish with lime." },
    ],
  },
  {
    slug: "avocado-toast",
    name: "Avocado on Sourdough",
    description: "Lunch when there is nothing in the house.",
    servings: 1,
    prepTime: 5,
    cookingTime: 5,
    tags: ["lunch", "vegetarian", "vegan", "dairy-free"],
    lines: [
      line("avocado", 1, "piece"),
      line("sourdough bread", 2, "piece"),
      line("lemon", null, null, "a squeeze"),
      line("olive oil", 1, "tablespoon"),
      line("salt", null, null, "flaky"),
    ],
    steps: [
      { text: "Toast the bread properly dark." },
      { text: "Crush the avocado with lemon and salt, pile on." },
    ],
  },
  {
    slug: "roast-potatoes",
    name: "Roast Potatoes",
    description: "Parboil, rough up, roast hard. Three hours if you like.",
    servings: 6,
    prepTime: 15,
    cookingTime: 180,
    tags: ["side", "american", "vegan", "vegetarian", "gluten-free", "dairy-free"],
    lines: [
      line("potatoes", 1.5, "kilogram"),
      line("olive oil", 100, "milliliter"),
      line("garlic", 6, "piece", "unpeeled"),
      line("salt", null, null),
    ],
    steps: [
      { text: "Parboil until the edges start to break up.", timerSeconds: 600 },
      { text: "Drain, shake hard in the colander to rough them up." },
      { text: "Roast in hot fat, turning once.", timerSeconds: 3600 },
    ],
  },
  {
    slug: "granola",
    name: "Maple Almond Granola",
    description: "One tray, one month of breakfasts.",
    servings: 12,
    prepTime: 10,
    cookingTime: 40,
    tags: ["breakfast", "snack", "vegan", "vegetarian", "dairy-free"],
    lines: [
      line("rolled oats", 400, "gram"),
      line("almonds", 150, "gram", "roughly chopped"),
      line("maple syrup", 120, "milliliter"),
      line("olive oil", 60, "milliliter"),
      line("cinnamon", 2, "teaspoon"),
    ],
    steps: [
      { text: "Toss everything until evenly coated." },
      { text: "Bake low, stirring every ten minutes.", timerSeconds: 2400 },
      { text: "Cool completely on the tray — that is where the clusters form." },
    ],
  },
  {
    slug: "pbj",
    name: "Peanut Butter & Jelly Sandwich",
    description: "The staple-check demo recipe — see the `staples` fixture below.",
    servings: 1,
    prepTime: 3,
    cookingTime: 0,
    tags: ["lunch", "snack"],
    lines: [
      line("bread", 2, "piece"),
      line("peanut butter", 2, "tablespoon"),
      line("jelly", 1, "tablespoon"),
    ],
    steps: [
      { text: "Spread peanut butter on one slice, jelly on the other." },
      { text: "Press together and slice on the diagonal, if you're feeling fancy." },
    ],
  },
];

/**
 * `lastAddedDaysAgo` omitted (milk, eggs) leaves `lastAddedAt: null`, i.e. due
 * immediately, so opening the list shows the *lazy staple reminder* firing.
 *
 * Bread is deliberately given a recent `lastAddedAt` instead, so that lazy
 * reminder does NOT also add it to the active list — that would beat the
 * newer "freshly stocked" feature to the punch and merge into an existing
 * row, which never gets pre-checked (see `mergeIntoList`). Bread's own
 * freshness for *that* feature comes from a separate signal — a checked-off
 * item on the completed `demo-list-history` list below, 3 days before now,
 * inside its 7-day frequency. Add the "Peanut Butter & Jelly Sandwich"
 * recipe via "Add from recipes" to see bread show up pre-checked as
 * "Already have it" while peanut butter and jelly still need buying.
 */
const staples: Array<{ ingredient: string; frequencyDays: number; lastAddedDaysAgo?: number }> = [
  { ingredient: "milk", frequencyDays: 5 },
  { ingredient: "eggs", frequencyDays: 7 },
  { ingredient: "bread", frequencyDays: 7, lastAddedDaysAgo: 3 },
];

/** Recipes whose ingredients are merged into the active list, chosen for the flour case. */
const listedRecipes = ["pancakes", "shortbread", "carbonara"];

/**
 * Stores are global rows, like `Ingredient` — upserted by name, never
 * deleted (see `findOrCreateStore` in `receipts.service.ts`, which this
 * mirrors). Six of them so `SpendBarList`'s by-store truncation (past four
 * rows) has something real to fold away, not just the top four.
 */
const stores = ["Trader Joe's", "Whole Foods", "Safeway", "Costco", "Kroger", "Target"];

type DemoPurchase = {
  ingredient: string;
  price: number;
  quantity: number | null;
  store: string;
  monthsAgo: number;
  day: number;
};

const purchase = (
  ingredient: string,
  price: number,
  quantity: number | null,
  store: string,
  monthsAgo: number,
  day: number
): DemoPurchase => ({ ingredient, price, quantity, store, monthsAgo, day });

/**
 * Six months (`monthsAgo: 0` is the current month), enough for the trend
 * chart to have real bars under every preset from "This month" through
 * "6 mo". Ingredients span all seven categories already in the `ingredients`
 * table above, so `byCategory` truncates past five rows the same way
 * `byStore` does past four.
 */
const purchases: DemoPurchase[] = [
  // This month
  purchase("chicken thighs", 14.5, 2, "Trader Joe's", 0, 2),
  purchase("salmon", 23.8, 2, "Whole Foods", 0, 3),
  purchase("olive oil", 8.99, 1, "Trader Joe's", 0, 5),
  purchase("milk", 4.99, 2, "Trader Joe's", 0, 5),
  purchase("red lentils", 3.49, 1, "Trader Joe's", 0, 8),
  purchase("sourdough bread", 4.49, 1, "Trader Joe's", 0, 10),
  purchase("beef mince", 12.6, 2, "Costco", 0, 11),
  purchase("parmesan", 6.5, 1, "Whole Foods", 0, 14),
  // 1 month ago
  purchase("chicken thighs", 13.9, 2, "Safeway", 1, 3),
  purchase("tofu", 3.2, 1, "Trader Joe's", 1, 4),
  purchase("basmati rice", 5.4, 1, "Costco", 1, 6),
  purchase("cheddar", 5.99, 1, "Trader Joe's", 1, 9),
  purchase("avocado", 4.5, 3, "Whole Foods", 1, 12),
  purchase("eggs", 4.29, 1, "Trader Joe's", 1, 16),
  // 2 months ago
  purchase("salmon", 21.4, 2, "Whole Foods", 2, 2),
  purchase("garlic", 1.99, 1, "Trader Joe's", 2, 5),
  purchase("tortillas", 3.5, 1, "Safeway", 2, 7),
  purchase("black beans", 1.79, 2, "Trader Joe's", 2, 10),
  purchase("mozzarella", 5.49, 1, "Whole Foods", 2, 13),
  purchase("bacon", 6.99, 1, "Kroger", 2, 18),
  // 3 months ago
  purchase("chicken thighs", 15.1, 2, "Trader Joe's", 3, 3),
  purchase("prawns", 11.25, 1, "Whole Foods", 3, 6),
  purchase("flour", 3.1, 1, "Trader Joe's", 3, 8),
  purchase("butter", 4.6, 1, "Trader Joe's", 3, 11),
  purchase("tomatoes", 2.99, 2, "Safeway", 3, 15),
  purchase("banana", 1.49, 3, "Target", 3, 19),
  // 4 months ago
  purchase("beef mince", 11.9, 2, "Costco", 4, 2),
  purchase("mushrooms", 3.79, 1, "Whole Foods", 4, 5),
  purchase("spring onions", 1.5, 1, "Trader Joe's", 4, 9),
  purchase("yoghurt", 4.2, 1, "Trader Joe's", 4, 12),
  purchase("bell pepper", 2.99, 2, "Safeway", 4, 17),
  // 5 months ago
  purchase("chicken thighs", 14.2, 2, "Trader Joe's", 5, 4),
  purchase("cucumber", 1.29, 2, "Trader Joe's", 5, 7),
  purchase("feta", 4.99, 1, "Whole Foods", 5, 10),
  purchase("olives", 3.99, 1, "Costco", 5, 14),
  purchase("apples", 3.5, 4, "Kroger", 5, 20),
];

function requireEnv() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to touch demo data with NODE_ENV=production.");
  }
  if (!clerkOrgId || !clerkUserId) {
    throw new Error(
      [
        "DEMO_CLERK_ORG_ID and DEMO_CLERK_USER_ID must both be set.",
        "",
        "Household rows key on clerkOrgId, which is not a local foreign key, so",
        "fixtures seeded against a made-up id are invisible to every signed-in",
        "user. Use the real ids from your Clerk dashboard:",
        "",
        "  clerk api /organizations | jq -r '.data[] | \"\\(.id)  \\(.name)\"'",
        "  clerk api /users         | jq -r '.[] | .id'",
      ].join("\n")
    );
  }
}

/**
 * Deletes every row this script owns and nothing else.
 *
 * Cascades are emulated by Prisma (relationMode = "prisma"), so
 * RecipeIngredient, RecipeTag, RecipeImage, UserFavoriteRecipe and
 * GroceryListItem rows go with their parents. Ingredients are left alone —
 * they are global and other households' recipes may reference them.
 */
async function clean(prisma: PrismaClient) {
  const [staplesDeleted, recipesDeleted, listsDeleted, purchasesDeleted] = [
    await prisma.stapleReminder.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    await prisma.recipe.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    await prisma.groceryList.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    await prisma.purchase.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
  ];
  return {
    staples: staplesDeleted.count,
    recipes: recipesDeleted.count,
    lists: listsDeleted.count,
    purchases: purchasesDeleted.count,
  };
}

async function main() {
  requireEnv();

  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  const actor = { clerkOrgId: clerkOrgId!, clerkUserId: clerkUserId! };

  if (CLEAN_ONLY) {
    const removed = await clean(prisma);
    console.log(
      `Removed ${removed.recipes} demo recipes, ${removed.staples} staples, ${removed.lists} grocery lists and ${removed.purchases} purchases. Ingredients and stores left in place.`
    );
    await prisma.$disconnect();
    return;
  }

  // Reference data is a hard prerequisite: units resolve by name below, and an
  // empty table would silently produce unitless recipes.
  const unitCount = await prisma.measurementUnit.count();
  if (unitCount === 0) {
    throw new Error("No measurement units found — run `pnpm db:seed` first.");
  }

  await clean(prisma);

  for (const ingredient of ingredients) {
    await prisma.ingredient.upsert({
      where: { name: ingredient.name },
      create: ingredient,
      update: { category: ingredient.category },
    });
  }

  const ingredientIds = new Map(
    (await prisma.ingredient.findMany({ select: { id: true, name: true } })).map((row) => [
      row.name,
      row.id,
    ])
  );
  const unitIds = new Map(
    (await prisma.measurementUnit.findMany({ select: { id: true, name: true } })).map((row) => [
      row.name,
      row.id,
    ])
  );
  const tagIds = new Map(
    (await prisma.tag.findMany({ select: { id: true, name: true } })).map((row) => [
      row.name,
      row.id,
    ])
  );

  const resolve = (map: Map<string, string>, key: string, kind: string) => {
    const id = map.get(key);
    if (!id) {
      throw new Error(`Unknown ${kind} "${key}" — is prisma/seed.ts up to date?`);
    }
    return id;
  };

  // Spread createdAt across recent weeks so "newest first" ordering is visible
  // rather than every recipe sharing one timestamp.
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  for (const [index, recipe] of recipes.entries()) {
    await prisma.recipe.create({
      data: {
        id: `${DEMO_PREFIX}recipe-${recipe.slug}`,
        clerkOrgId: actor.clerkOrgId,
        createdBy: actor.clerkUserId,
        name: recipe.name,
        description: recipe.description,
        servings: recipe.servings,
        prepTime: recipe.prepTime,
        cookingTime: recipe.cookingTime,
        createdAt: new Date(now - (recipes.length - index) * 2 * DAY_MS),
        instructions: recipe.steps.map((step, stepIndex) => ({ step: stepIndex + 1, ...step })),
        ingredients: {
          create: recipe.lines.map((entry) => ({
            ingredientId: resolve(ingredientIds, entry.ingredient, "ingredient"),
            unitId: entry.unit ? resolve(unitIds, entry.unit, "unit") : null,
            amount: entry.amount,
            notes: entry.notes,
          })),
        },
        tags: {
          create: recipe.tags.map((tag) => ({ tagId: resolve(tagIds, tag, "tag") })),
        },
      },
    });
  }

  for (const staple of staples) {
    await prisma.stapleReminder.create({
      data: {
        id: `${DEMO_PREFIX}staple-${staple.ingredient.replace(/\s+/g, "-")}`,
        clerkOrgId: actor.clerkOrgId,
        ingredientId: resolve(ingredientIds, staple.ingredient, "ingredient"),
        frequencyDays: staple.frequencyDays,
        lastAddedAt:
          staple.lastAddedDaysAgo === undefined
            ? null
            : new Date(now - staple.lastAddedDaysAgo * DAY_MS),
      },
    });
  }

  // Pre-create the active list with a demo id so the next run can delete it.
  // getActive() find-or-creates, so it adopts this row instead of making its own
  // and the one-active-list-per-household invariant still holds.
  const alreadyActive = await prisma.groceryList.findFirst({
    where: { clerkOrgId: actor.clerkOrgId, status: "active" },
    select: { id: true },
  });
  if (!alreadyActive) {
    await prisma.groceryList.create({
      data: { id: `${DEMO_PREFIX}list-active`, clerkOrgId: actor.clerkOrgId },
    });
  }

  // Built by the real service rather than hand-written rows, so the fixture
  // can never drift from the merging rules it is meant to demonstrate. This
  // also exercises getOrSync (creating the local User) and applyDueStaples.
  const list = await addFromRecipes(
    prisma,
    listedRecipes.map((slug) => `${DEMO_PREFIX}recipe-${slug}`),
    actor
  );

  // Favorites are personal, so they hang off the local User row that
  // addFromRecipes has just guaranteed exists.
  const user = await prisma.user.findUniqueOrThrow({
    where: { clerkUserId: actor.clerkUserId },
    select: { id: true },
  });
  const favorites = recipes.filter((recipe) => recipe.favorite);
  for (const recipe of favorites) {
    await prisma.userFavoriteRecipe.create({
      data: { userId: user.id, recipeId: `${DEMO_PREFIX}recipe-${recipe.slug}` },
    });
  }

  // A completed list so `groceryLists.history` has something to return.
  await prisma.groceryList.create({
    data: {
      id: `${DEMO_PREFIX}list-history`,
      clerkOrgId: actor.clerkOrgId,
      status: "completed",
      createdAt: new Date(now - 9 * DAY_MS),
      items: {
        create: [
          {
            ingredientId: resolve(ingredientIds, "tomatoes", "ingredient"),
            unitId: resolve(unitIds, "gram", "unit"),
            quantity: 500,
            source: "manual",
            checked: true,
          },
          {
            ingredientId: resolve(ingredientIds, "olive oil", "ingredient"),
            unitId: resolve(unitIds, "milliliter", "unit"),
            quantity: 500,
            source: "manual",
            checked: true,
          },
          // Backs the "freshly stocked staple" demo — see the `staples`
          // fixture above. `updatedAt` is set explicitly to 3 days ago so
          // `getFreshlyStockedStaples` reads it as "checked off recently,"
          // not "checked off just now by this script running."
          {
            ingredientId: resolve(ingredientIds, "bread", "ingredient"),
            unitId: resolve(unitIds, "piece", "unit"),
            quantity: 2,
            source: "manual",
            checked: true,
            createdAt: new Date(now - 3 * DAY_MS),
            updatedAt: new Date(now - 3 * DAY_MS),
          },
        ],
      },
    },
  });

  // Stores are global, upserted by name — same reasoning as ingredients above.
  for (const storeName of stores) {
    await prisma.store.upsert({ where: { name: storeName }, create: { name: storeName }, update: {} });
  }
  const storeIds = new Map(
    (await prisma.store.findMany({ where: { name: { in: stores } }, select: { id: true, name: true } })).map(
      (row) => [row.name, row.id]
    )
  );

  const today = new Date();
  for (const [index, entry] of purchases.entries()) {
    await prisma.purchase.create({
      data: {
        id: `${DEMO_PREFIX}purchase-${index}`,
        clerkOrgId: actor.clerkOrgId,
        userId: user.id,
        ingredientId: resolve(ingredientIds, entry.ingredient, "ingredient"),
        storeId: resolve(storeIds, entry.store, "store"),
        price: entry.price,
        quantity: entry.quantity,
        purchasedAt: new Date(today.getFullYear(), today.getMonth() - entry.monthsAgo, entry.day),
      },
    });
  }

  const flour = list.items.find((item) => item.ingredient.name === "flour");
  console.log(
    [
      `Seeded ${recipes.length} recipes (${favorites.length} favorited), ${staples.length} staples,`,
      `2 grocery lists and ${purchases.length} purchases across 6 months for org ${actor.clerkOrgId}.`,
      "",
      `Active list has ${list.items.length} lines. Cross-family check — flour:`,
      `  quantity=${flour?.quantity ?? "null"} unit=${flour?.unit?.name ?? "null"}`,
      flour && flour.quantity === null
        ? "  ✓ correct: cups + grams cannot be summed, so the line keeps no number."
        : "  ✗ expected a single unitless flour line — check lib/units.ts.",
      "",
      "Freshly-stocked staple check: add \"Peanut Butter & Jelly Sandwich\" via",
      "Add from recipes — bread should land pre-checked as \"Already have it\"",
      "(checked off 3 days ago, inside its 7-day frequency) while peanut",
      "butter and jelly still need buying.",
    ].join("\n")
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
