/**
 * Bird families strongly associated with residential gardens, feeders, and backyards worldwide.
 * Used to prioritise species so new users encounter recognisable common birds first.
 */
export const BACKYARD_FAMILIES = new Set([
  // Perching / songbird families
  'Paridae',          // Chickadees, Tits
  'Sittidae',         // Nuthatches
  'Certhiidae',       // Creepers
  'Corvidae',         // Jays, Crows, Magpies
  'Turdidae',         // Robins, Bluebirds, Thrushes
  'Mimidae',          // Mockingbirds, Catbirds, Thrashers
  'Sturnidae',        // Starlings, Mynas
  'Troglodytidae',    // Wrens
  'Regulidae',        // Kinglets
  'Bombycillidae',    // Waxwings
  'Fringillidae',     // Finches, Goldfinches, Siskins
  'Passerellidae',    // New World Sparrows, Juncos, Towhees
  'Cardinalidae',     // Cardinals, Grosbeaks, Buntings
  'Icteridae',        // Blackbirds, Grackles, Orioles
  'Parulidae',        // Wood-Warblers
  'Passeridae',       // House Sparrow, Eurasian Tree Sparrow
  'Motacillidae',     // Wagtails, Pipits
  'Muscicapidae',     // Old World Flycatchers (European Robin, etc.)
  'Sylviidae',        // Old World Warblers
  'Pycnonotidae',     // Bulbuls
  'Zosteropidae',     // White-eyes
  'Nectariniidae',    // Sunbirds
  'Leiothrichidae',   // Laughingthrushes
  // Doves / Pigeons
  'Columbidae',
  // Woodpeckers
  'Picidae',
  // Swallows
  'Hirundinidae',
  // Quail
  'Odontophoridae',
]);

export const GROUP_ORDERS: Record<string, string[]> = {
  all:          [],
  songbirds:    ['Passeriformes'],
  waterfowl:    ['Anseriformes'],
  raptors:      ['Accipitriformes', 'Falconiformes'],
  owls:         ['Strigiformes'],
  shorebirds:   ['Charadriiformes'],
  woodpeckers:  ['Piciformes'],
  waterbirds:   ['Pelecaniformes', 'Suliformes', 'Gaviiformes', 'Podicipediformes'],
  hummingbirds: ['Apodiformes'],
};
