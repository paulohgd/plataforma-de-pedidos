const img = {
  salad: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=720&q=70",
  classic: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=720&q=70",
  bacon: "https://images.unsplash.com/photo-1553979459-d2229ba7433b?auto=format&fit=crop&w=720&q=70",
  double: "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&w=720&q=70",
  chicken: "https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=720&q=70",
  ribs: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=720&q=70",
  fries: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=720&q=70",
  cheeseFries: "https://images.unsplash.com/photo-1585109649139-366815a0d713?auto=format&fit=crop&w=720&q=70",
  onion: "https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=720&q=70",
  fried: "https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=720&q=70",
  balls: "https://images.unsplash.com/photo-1548340748-6d2b7d7da280?auto=format&fit=crop&w=720&q=70",
  coke: "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=720&q=70",
  cokeZero: "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=720&q=60",
  guarana: "https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?auto=format&fit=crop&w=720&q=70",
  water: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=720&q=70",
  juice: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=720&q=70",
  lemonade: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=720&q=70",
  choc: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=720&q=70",
  straw: "https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=720&q=70",
  brownie: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=720&q=70",
  cheese: "https://images.unsplash.com/photo-1611293388250-580b08c4a145?auto=format&fit=crop&w=720&q=70",
  cookie: "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=720&q=70",
  lava: "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?auto=format&fit=crop&w=720&q=70",
};

const ponto = {
  id: "ponto",
  name: "Ponto",
  min: 1,
  max: 1,
  items: [
    { id: "mal", name: "Mal passado", price: 0 },
    { id: "ao-ponto", name: "Ao ponto", price: 0 },
    { id: "bem", name: "Bem passado", price: 0 },
  ],
};

const molho = {
  id: "molho",
  name: "Molho",
  min: 1,
  max: 1,
  items: [
    { id: "casa", name: "Maionese da casa", price: 0 },
    { id: "barbecue", name: "Barbecue", price: 0 },
    { id: "cheddar", name: "Cheddar", price: 4 },
    { id: "ketchup", name: "Ketchup", price: 0 },
  ],
};

const extras = [
  { id: "cheddar", name: "Cheddar", price: 7, max: 2 },
  { id: "bacon", name: "Bacon", price: 8, max: 1 },
  { id: "queijo-prato", name: "Queijo prato", price: 6, max: 1 },
  { id: "picles", name: "Picles", price: 4, max: 1 },
  { id: "jalapeno", name: "Jalapeño", price: 5, max: 1 },
  { id: "cebola-crispy", name: "Cebola crispy", price: 6, max: 1 },
  { id: "ovo", name: "Ovo", price: 4, max: 1 },
];

export const seedCategories = [
  { id: "entradas", name: "Entradas" },
  { id: "burgers", name: "Burgers e sanduíches" },
  { id: "bebidas", name: "Bebidas" },
  { id: "sobremesas", name: "Sobremesas" },
];

export const products = [
  {
    id: "batata-frita",
    category: "entradas",
    kind: "fries",
    name: "Batata frita",
    description: "Porção individual de batata crocante. O molho você escolhe na hora de montar o pedido.",
    price: 22,
    image: img.fries,
    featured: true,
  },
  {
    id: "batata-cheddar",
    category: "entradas",
    kind: "simple",
    name: "Batata com cheddar",
    description: "Batata frita com cheddar cremoso da casa, bacon picado e cebolinha. O molho de cheddar vai à parte.",
    price: 36,
    image: img.cheeseFries,
  },
  {
    id: "aneis",
    category: "entradas",
    kind: "fries",
    name: "Anéis de cebola",
    description: "Cebola empanada e frita, crocante por fora e macia por dentro. Escolha o molho.",
    price: 24,
    image: img.onion,
  },
  {
    id: "frango-crocante",
    category: "entradas",
    kind: "simple",
    name: "Frango crocante",
    description: "Pedaços de frango frito com glaze de mel e alho, levemente picante.",
    price: 32,
    image: img.fried,
  },
  {
    id: "bolinhas",
    category: "entradas",
    kind: "simple",
    name: "Palitos de queijo",
    description: "Palitos de queijo empanados e fritos. Acompanha molho da casa.",
    price: 28,
    image: img.balls,
  },
  {
    id: "classico",
    category: "burgers",
    kind: "beef",
    name: "Clássico",
    description: "Pão brioche, hambúrguer 160g e queijo prato. Simples, no ponto que você escolher.",
    price: 34,
    image: img.classic,
    featured: true,
  },
  {
    id: "cheese-salad",
    category: "burgers",
    kind: "beef",
    name: "Cheese salad",
    description: "Pão, hambúrguer 160g, queijo prato, cebola roxa, tomate e alface.",
    price: 40,
    image: img.salad,
    featured: true,
  },
  {
    id: "bacon-chapa",
    category: "burgers",
    kind: "beef",
    name: "Bacon na chapa",
    description: "Hambúrguer 160g, cheddar, bacon crocante, cebola caramelizada e picles da casa.",
    price: 44,
    image: img.bacon,
  },
  {
    id: "duplo",
    category: "burgers",
    kind: "beef",
    name: "Duplo da casa",
    description: "Dois hambúrgueres de 160g, cheddar, bacon, picles e molho da casa no pão brioche.",
    price: 52,
    image: img.double,
    featured: true,
  },
  {
    id: "frango-brasa",
    category: "burgers",
    kind: "chicken",
    name: "Frango na brasa",
    description: "Frango empanado, cheddar, alface, tomate e maionese de alho no pão brioche.",
    price: 38,
    image: img.chicken,
  },
  {
    id: "costela",
    category: "burgers",
    kind: "sandwich",
    name: "Costela barbecue",
    description: "Costela assada na brasa, com batata, picles e molho barbecue.",
    price: 48,
    image: img.ribs,
  },
  {
    id: "coca-cola",
    category: "bebidas",
    kind: "simple",
    name: "Coca-Cola lata",
    description: "Lata 350ml.",
    price: 9,
    image: img.coke,
    featured: true,
  },
  {
    id: "coca-zero",
    category: "bebidas",
    kind: "simple",
    name: "Coca-Cola sem açúcar",
    description: "Lata 350ml.",
    price: 9,
    image: img.cokeZero,
  },
  {
    id: "guarana",
    category: "bebidas",
    kind: "simple",
    name: "Guaraná lata",
    description: "Lata 350ml.",
    price: 9,
    image: img.guarana,
  },
  {
    id: "agua",
    category: "bebidas",
    kind: "simple",
    name: "Água sem gás",
    description: "Garrafa 500ml.",
    price: 6,
    image: img.water,
  },
  {
    id: "suco",
    category: "bebidas",
    kind: "simple",
    name: "Suco de laranja",
    description: "Feito na hora, sem açúcar adicionado.",
    price: 13,
    image: img.juice,
  },
  {
    id: "limonada",
    category: "bebidas",
    kind: "simple",
    name: "Limonada",
    description: "Limão, água e um toque de hortelã. Feita na casa.",
    price: 13,
    image: img.lemonade,
  },
  {
    id: "shake-chocolate",
    category: "bebidas",
    kind: "simple",
    name: "Milkshake de chocolate",
    description: "Sorvete de chocolate, leite e calda. Copo de 400ml.",
    price: 22,
    image: img.choc,
  },
  {
    id: "shake-morango",
    category: "bebidas",
    kind: "simple",
    name: "Milkshake de morango",
    description: "Sorvete de baunilha, leite e calda de morango. Copo de 400ml.",
    price: 22,
    image: img.straw,
  },
  {
    id: "brownie",
    category: "sobremesas",
    kind: "simple",
    name: "Brownie",
    description: "Brownie de chocolate meio amargo, massa úmida, cortado na hora.",
    price: 18,
    image: img.brownie,
    featured: true,
  },
  {
    id: "bolo-morango",
    category: "sobremesas",
    kind: "simple",
    name: "Bolo de morango",
    description: "Camadas de creme e morango, finalizado com frutas frescas.",
    price: 26,
    image: img.cheese,
  },
  {
    id: "cookie",
    category: "sobremesas",
    kind: "simple",
    name: "Cookie",
    description: "Cookie grande de chocolate, massa macia e casquinha crocante.",
    price: 14,
    image: img.cookie,
  },
  {
    id: "brownie-sorvete",
    category: "sobremesas",
    kind: "simple",
    name: "Brownie com sorvete",
    description: "Brownie de chocolate com sorvete de creme e calda.",
    price: 24,
    image: img.lava,
  },
];

const featuredOrder = ["cheese-salad", "coca-cola", "batata-frita", "classico", "duplo", "brownie"];

export const seedProducts = products.map((product) => ({
  id: product.id,
  category: product.category,
  kind: product.kind,
  name: product.name,
  description: product.description,
  price: product.price,
  image: product.image,
  featured: Boolean(product.featured),
  featuredRank: product.featured ? Math.max(0, featuredOrder.indexOf(product.id)) : 0,
}));

export function orderFeatured(list) {
  const featured = list.filter((product) => product.featured);
  const fallback = new Map(featuredOrder.map((id, index) => [id, index]));
  const hasRank = featured.some((product) => Number(product.featuredRank) > 0);
  return featured.slice().sort((a, b) => {
    const rankA = hasRank ? Number(a.featuredRank) || 0 : (fallback.get(a.id) ?? 1000);
    const rankB = hasRank ? Number(b.featuredRank) || 0 : (fallback.get(b.id) ?? 1000);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
  });
}

const sideIds = ["batata-frita", "batata-cheddar", "aneis", "frango-crocante"];
const drinkIds = ["coca-cola", "guarana", "limonada", "agua"];

export function hydrateProducts(list) {
  const byId = new Map(list.map((product) => [product.id, product]));

  function optionFrom(id, max) {
    const product = byId.get(id);
    if (!product) return null;
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      max,
      image: product.image,
    };
  }

  const sideItems = sideIds.map((id) => optionFrom(id, 2)).filter(Boolean);
  const drinkItems = drinkIds.map((id) => optionFrom(id, 3)).filter(Boolean);
  const sides = sideItems.length
    ? {
        id: "porcao",
        name: "Aceita uma porçãozinha?",
        label: "Porção",
        min: 0,
        max: 4,
        items: sideItems,
      }
    : null;
  const drinks = drinkItems.length
    ? {
        id: "bebida",
        name: "Vai uma bebidinha?",
        label: "Bebida",
        min: 0,
        max: 5,
        items: drinkItems,
      }
    : null;

  function meal(groups) {
    return [...groups, sides, drinks].filter(Boolean);
  }

  return list.map((product) => {
    let groups = [];
    if (product.kind === "beef") {
      groups = meal([
        ponto,
        {
          id: "adicionais",
          name: "Adicionais",
          min: 0,
          max: 8,
          items: [{ id: "burger-extra", name: "Burger 160g", price: 18, max: 2 }, ...extras],
        },
      ]);
    } else if (product.kind === "chicken") {
      groups = meal([
        {
          id: "adicionais",
          name: "Adicionais",
          min: 0,
          max: 8,
          items: [{ id: "frango-extra", name: "Frango empanado", price: 14, max: 1 }, ...extras],
        },
      ]);
    } else if (product.kind === "sandwich") {
      groups = meal([
        {
          id: "adicionais",
          name: "Adicionais",
          min: 0,
          max: 8,
          items: extras,
        },
      ]);
    } else if (product.kind === "fries") {
      groups = [molho];
    }
    return { ...product, groups };
  });
}
