// Demo merchant catalog. Prices are integer cents so totals never drift.
// `category` and `badge` only affect how the storefront shows a product.
export const categories = [
  { id: "picks", label: "Picks" },
  { id: "beans", label: "Beans" },
  { id: "brewing", label: "Brewing" },
  { id: "extras", label: "Extras" },
];

export const catalog = [
  { sku: "ETH-200", name: "Ethiopia Yirgacheffe, 200g", priceCents: 450, note: "Light roast, floral and citrus", category: "beans", pick: true, badge: "Popular" },
  { sku: "COL-200", name: "Colombia Huila, 200g", priceCents: 400, note: "Medium roast, caramel and red apple", category: "beans", pick: true },
  { sku: "DEC-200", name: "Decaf Brazil, 200g", priceCents: 420, note: "Medium-dark roast, cocoa and hazelnut", category: "beans" },
  { sku: "KEN-200", name: "Kenya Nyeri, 200g", priceCents: 500, note: "Light roast, blackcurrant and grapefruit", category: "beans", badge: "New" },
  { sku: "GTM-200", name: "Guatemala Antigua, 200g", priceCents: 430, note: "Medium roast, milk chocolate and orange", category: "beans" },
  { sku: "FLT-100", name: "Paper filters, 100 pack", priceCents: 200, note: "Fits 1-2 cup drippers", category: "brewing", pick: true },
  { sku: "GRD-001", name: "Hand grinder", priceCents: 2200, note: "Steel burr, 30 click settings", category: "brewing", pick: true },
  { sku: "DRP-001", name: "Ceramic dripper", priceCents: 700, note: "Cone dripper for 1-2 cups", category: "brewing" },
  { sku: "KTL-001", name: "Pour-over kettle", priceCents: 1500, note: "Gooseneck, 600 ml", category: "brewing" },
  { sku: "BAG-010", name: "Drip bags, 10 pack", priceCents: 300, note: "Single-serve, just add hot water", category: "extras", pick: true, badge: "New" },
  { sku: "MUG-001", name: "Stoneware mug", priceCents: 550, note: "Handmade, 300 ml", category: "extras", pick: true },
];

export const findProduct = (sku) => catalog.find((p) => p.sku === String(sku).toUpperCase());
