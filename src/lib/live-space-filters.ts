export type SpaceStatusFilter = "all" | "available" | "occupied" | "unavailable";
type Space = { name: string; sportName: string; state: string };

export function spaceStatusGroup(state: string): Exclude<SpaceStatusFilter, "all"> {
  return state === "AVAILABLE" ? "available" : state === "IN_USE" || state === "HELD" ? "occupied" : "unavailable";
}

export function filterLiveSpaces<T extends Space>(spaces: T[], query: string, status: SpaceStatusFilter) {
  const search = query.trim().toLocaleLowerCase();
  return spaces.filter(space => (status === "all" || spaceStatusGroup(space.state) === status) &&
    (!search || `${space.name} ${space.sportName}`.toLocaleLowerCase().includes(search)));
}
