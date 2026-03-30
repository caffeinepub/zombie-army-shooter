import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActor } from "./useActor";

export interface Score {
  name: string;
  score: bigint;
}

export function useGetTopScores() {
  const { actor, isFetching } = useActor();
  return useQuery<Score[]>({
    queryKey: ["topScores"],
    queryFn: async () => {
      if (!actor) return [];
      // The Backend wrapper class holds the raw ICP actor in a private field
      return (actor as any).actor.getTopScores();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useSubmitScore() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      score,
    }: {
      name: string;
      score: number;
    }) => {
      if (!actor) throw new Error("No actor available");
      await (actor as any).actor.submitScore(name, BigInt(score));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topScores"] });
    },
  });
}
