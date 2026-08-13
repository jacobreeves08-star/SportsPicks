import { useQuery } from "@tanstack/react-query";
import { getMe } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

export function useMe() {
  return useQuery({ queryKey: queryKeys.me(), queryFn: getMe });
}
