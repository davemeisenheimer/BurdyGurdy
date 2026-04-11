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

/** English common names for taxonomic orders, keyed by the scientific order name
 *  that the eBird taxonomy API returns in the `order` field. */
export const ORDER_COMMON_NAMES: Record<string, string> = {
  Accipitriformes:    'Hawks, Kites, and Eagles',
  Anseriformes:       'Waterfowl',
  Apodiformes:        'Swifts and Hummingbirds',
  Apterygiformes:     'Kiwis',
  Bucerotiformes:     'Hornbills and Allies',
  Caprimulgiformes:   'Nightjars and Allies',
  Cariamiformes:      'Seriemas',
  Casuariiformes:     'Cassowaries and Emus',
  Cathartiformes:     'New World Vultures',
  Charadriiformes:    'Shorebirds and Allies',
  Ciconiiformes:      'Storks',
  Coliiformes:        'Mousebirds',
  Columbiformes:      'Pigeons and Doves',
  Coraciiformes:      'Kingfishers and Allies',
  Cuculiformes:       'Cuckoos',
  Eurypygiformes:     'Sunbittern and Kagu',
  Falconiformes:      'Falcons and Caracaras',
  Galliformes:        'Landfowl',
  Gaviiformes:        'Loons',
  Gruiformes:         'Rails, Gallinules, and Cranes',
  Leptosomiformes:    'Cuckoo-roller',
  Mesitornithiformes: 'Mesites',
  Musophagiformes:    'Turacos',
  Opisthocomiformes:  'Hoatzin',
  Otidiformes:        'Bustards',
  Passeriformes:      'Perching Birds',
  Pelecaniformes:     'Herons, Ibises, and Pelicans',
  Phaethontiformes:   'Tropicbirds',
  Phoenicopteriformes:'Flamingos',
  Piciformes:         'Woodpeckers and Allies',
  Podicipediformes:   'Grebes',
  Procellariiformes:  'Albatrosses and Allies',
  Psittaciformes:     'Parrots',
  Pterocliformes:     'Sandgrouse',
  Rheiformes:         'Rheas',
  Sphenisciformes:    'Penguins',
  Strigiformes:       'Owls',
  Struthioniformes:   'Ostriches',
  Suliformes:         'Gannets, Boobies, and Cormorants',
  Tinamiformes:       'Tinamous',
  Trogoniformes:      'Trogons',
  Trochiliformes:     'Hummingbirds',
};

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
