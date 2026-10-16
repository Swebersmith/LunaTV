// STORAGE_TYPE is a private runtime variable configured on the hosting platform.
// Keep NEXT_PUBLIC_STORAGE_TYPE as a fallback for existing Docker deployments.
export function getStorageType(): string {
  return process.env.STORAGE_TYPE || process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
}
