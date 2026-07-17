export function saveSelectedPlace(place) {
  sessionStorage.setItem('selectedPlace', JSON.stringify(place));
}

export function loadSelectedPlace() {
  const raw = sessionStorage.getItem('selectedPlace');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
