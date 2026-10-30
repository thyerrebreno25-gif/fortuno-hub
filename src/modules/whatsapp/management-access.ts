export function canViewWhatsAppManagement(role: string, canView: boolean) {
  return canView && ["MASTER", "ADMIN", "MANAGER"].includes(role);
}
