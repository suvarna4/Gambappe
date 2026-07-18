// A trimmed animal wordlist (design calls for 256; this MVP subset is
// plenty for demo-scale concurrent ghosts and keeps the file readable).
const ANIMALS = [
  "fox", "owl", "wolf", "hawk", "bear", "lynx", "crow", "swan", "deer", "seal",
  "otter", "raven", "heron", "moose", "puma", "ibex", "gecko", "koala", "panda", "tiger",
  "lemur", "orca", "stork", "finch", "viper", "cobra", "eagle", "shark", "whale", "zebra",
  "bison", "camel", "civet", "dingo", "ferret", "gazelle", "hyena", "jackal", "kite", "loon",
  "marten", "newt", "ocelot", "pika", "quail", "robin", "sable", "tapir", "urchin", "vole",
  "walrus", "yak", "adder", "badger", "condor", "dhole", "egret", "falcon", "gopher", "heron",
];

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

export function generateHandle(): string {
  const animal = ANIMALS[randomInt(ANIMALS.length)];
  const digits = String(randomInt(10000)).padStart(4, "0");
  return `${animal}-${digits}`;
}
