// Construction partagée de l'URL Google Maps Embed Directions (native et web,
// voir RouteMap.tsx / RouteMap.web.tsx). Documentation :
// https://developers.google.com/maps/documentation/embed/embed-reference#directions_mode
export interface LatLng {
  lat: number;
  lng: number;
}

export function buildEmbedUrl(apiKey: string, origin: LatLng, destination: LatLng): string {
  const params = new URLSearchParams({
    key: apiKey,
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: 'driving',
  });
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}
