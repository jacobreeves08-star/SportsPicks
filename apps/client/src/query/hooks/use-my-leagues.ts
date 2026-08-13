import { useQuery } from "@tanstack/react-query";
import { getMyLeagues } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

/** The multi-league home screen's data — no automatic polling; a
 * league list changing is a rare, non-time-critical event (unlike the
 * slate — see use-slate.ts), so refetch-on-focus/mount is enough. */
export function useMyLeagues() {
  return useQuery({ queryKey: queryKeys.myLeagues(), queryFn: getMyLeagues });
}
