// @ts-nocheck
export const idlFactory = ({ IDL }) => {
  const Score = IDL.Record({ name: IDL.Text, score: IDL.Nat });
  return IDL.Service({
    submitScore: IDL.Func([IDL.Text, IDL.Nat], [], []),
    getTopScores: IDL.Func([], [IDL.Vec(Score)], ['query']),
  });
};
export const init = ({ IDL }) => [];
