export interface BirdGroup {
  id: string;
  label: string;
  orders: string[]; // eBird order names; empty = no filter (all birds)
}

export const BIRD_GROUPS: BirdGroup[] = [
  { id: 'all',          label: 'All Birds',     orders: [] },
  { id: 'songbirds',    label: 'Songbirds',      orders: ['Passeriformes'] },
  { id: 'waterfowl',    label: 'Waterfowl',      orders: ['Anseriformes'] },
  { id: 'raptors',      label: 'Raptors',        orders: ['Accipitriformes', 'Falconiformes'] },
  { id: 'owls',         label: 'Owls',           orders: ['Strigiformes'] },
  { id: 'shorebirds',   label: 'Shorebirds',     orders: ['Charadriiformes'] },
  { id: 'woodpeckers',  label: 'Woodpeckers',    orders: ['Piciformes'] },
  { id: 'waterbirds',   label: 'Waterbirds',     orders: ['Pelecaniformes', 'Suliformes', 'Gaviiformes', 'Podicipediformes'] },
  { id: 'hummingbirds', label: 'Hummingbirds',   orders: ['Apodiformes'] },
];
