export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
