import Order "mo:core/Order";

actor {
  type Score = { name: Text; score: Nat };

  stable var scores: [Score] = [];

  public func submitScore(name: Text, score: Nat) : async () {
    scores := scores.concat([{ name; score }]);
  };

  public query func getTopScores() : async [Score] {
    let sorted = scores.sort(func(a: Score, b: Score) : Order.Order {
      if (a.score > b.score) #less
      else if (a.score < b.score) #greater
      else #equal
    });
    if (sorted.size() <= 10) return sorted;
    var result: [Score] = [];
    var i = 0;
    while (i < 10) {
      result := result.concat([sorted[i]]);
      i += 1;
    };
    result
  };
};
