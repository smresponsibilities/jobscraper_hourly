import type { Office, OfficeCity } from './office-data';

// Browsing anchors, not administrative boundaries or verified worksite areas.
export const OFFICE_AREAS: Record<OfficeCity, readonly { id: string; name: string; lat: number; lng: number }[]> = {
  Bengaluru: [
    { id: 'central', name: 'Central and MG Road', lat: 12.9716, lng: 77.605 },
    { id: 'indiranagar', name: 'Indiranagar and Domlur', lat: 12.9719, lng: 77.6412 },
    { id: 'koramangala', name: 'Koramangala', lat: 12.9352, lng: 77.6245 },
    { id: 'hsr', name: 'HSR and BTM Layout', lat: 12.9116, lng: 77.625 },
    { id: 'orr', name: 'Outer Ring Road', lat: 12.935, lng: 77.69 },
    { id: 'mahadevapura', name: 'Mahadevapura and KR Puram', lat: 12.995, lng: 77.695 },
    { id: 'whitefield', name: 'Whitefield', lat: 12.975, lng: 77.745 },
    { id: 'north', name: 'Hebbal and the north', lat: 13.04, lng: 77.615 },
    { id: 'south', name: 'Jayanagar and the south', lat: 12.905, lng: 77.585 },
    { id: 'west', name: 'Yeshwanthpur and the west', lat: 13.01, lng: 77.55 },
  ],
  Hyderabad: [
    { id: 'central', name: 'Central Hyderabad', lat: 17.407, lng: 78.462 },
    { id: 'hitec', name: 'HITEC City and Madhapur', lat: 17.448, lng: 78.391 },
    { id: 'gachibowli', name: 'Gachibowli and Financial District', lat: 17.427, lng: 78.342 },
    { id: 'north', name: 'Secunderabad and the north', lat: 17.46, lng: 78.498 },
    { id: 'east', name: 'Uppal and the east', lat: 17.401, lng: 78.559 },
    { id: 'south', name: 'Southern Hyderabad', lat: 17.295, lng: 78.44 },
  ],
  Pune: [
    { id: 'central', name: 'Central Pune', lat: 18.52, lng: 73.856 },
    { id: 'hinjawadi', name: 'Hinjawadi and Wakad', lat: 18.592, lng: 73.738 },
    { id: 'baner', name: 'Baner and Aundh', lat: 18.56, lng: 73.789 },
    { id: 'kharadi', name: 'Kharadi and Viman Nagar', lat: 18.555, lng: 73.941 },
    { id: 'hadapsar', name: 'Hadapsar and Magarpatta', lat: 18.51, lng: 73.927 },
    { id: 'pimpri', name: 'Pimpri and Chinchwad', lat: 18.638, lng: 73.797 },
  ],
  Mumbai: [
    { id: 'south', name: 'South Mumbai', lat: 18.937, lng: 72.833 },
    { id: 'central', name: 'Lower Parel and central Mumbai', lat: 19.004, lng: 72.835 },
    { id: 'bkc', name: 'Bandra and BKC', lat: 19.061, lng: 72.868 },
    { id: 'andheri', name: 'Andheri and western suburbs', lat: 19.12, lng: 72.865 },
    { id: 'powai', name: 'Powai and eastern suburbs', lat: 19.119, lng: 72.906 },
    { id: 'thane', name: 'Thane', lat: 19.218, lng: 72.978 },
    { id: 'navi', name: 'Navi Mumbai', lat: 19.045, lng: 73.023 },
  ],
  Chennai: [
    { id: 'central', name: 'Central Chennai', lat: 13.067, lng: 80.25 },
    { id: 'guindy', name: 'Guindy and Ekkatuthangal', lat: 13.009, lng: 80.212 },
    { id: 'perungudi', name: 'Perungudi and Taramani', lat: 12.972, lng: 80.244 },
    { id: 'sholinganallur', name: 'Sholinganallur and OMR', lat: 12.9, lng: 80.227 },
    { id: 'west', name: 'Ambattur and western Chennai', lat: 13.098, lng: 80.162 },
    { id: 'south', name: 'Tambaram and southern Chennai', lat: 12.923, lng: 80.128 },
  ],
};

export function officeArea(office: Office) {
  const distance = (a: { lat: number; lng: number }) => (a.lat - office.latitude) ** 2 + ((a.lng - office.longitude) * Math.cos(office.latitude * Math.PI / 180)) ** 2;
  return OFFICE_AREAS[office.city].reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest);
}
