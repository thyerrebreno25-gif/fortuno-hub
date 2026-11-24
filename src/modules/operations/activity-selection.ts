type Activity = { id: string; status: string; responsibleId?: string | null };
type Permissions = { canEdit: boolean; canDelete: boolean; canManage: boolean; userId?: string };
export function activitySelection<T extends Activity>(activities: T[], ids: string[], permissions: Permissions) {
  const transferable = (activity: Activity) => permissions.canEdit && Boolean(permissions.userId) && ["OPEN", "IN_PROGRESS", "PAUSED", "BLOCKED"].includes(activity.status) && (permissions.canManage || activity.responsibleId === permissions.userId);
  const selectable = activities.filter(activity => permissions.canEdit && (permissions.canDelete || transferable(activity)));
  const selectedIds = new Set(ids);
  const selected = selectable.filter(activity => selectedIds.has(activity.id));
  return { selectableIds: selectable.map(activity => activity.id), selected, transferableIds: selected.filter(transferable).map(activity => activity.id) };
}
