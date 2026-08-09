// Probabilities are expressed as integer weights out of 10,000.
// Current expected payout = ₱10.50 per completed spin.
// Keep the public odds display synchronized with these values.
module.exports = {
  tokenValiditySeconds: 7 * 24 * 60 * 60,
  prizes: [
    { id: "none", label: "Better luck next time", shortLabel: "Try Again", amount: 0, weight: 6739 },
    { id: "p10", label: "You won ₱10", shortLabel: "₱10", amount: 10, weight: 1500 },
    { id: "p20", label: "You won ₱20", shortLabel: "₱20", amount: 20, weight: 1000 },
    { id: "p50", label: "You won ₱50", shortLabel: "₱50", amount: 50, weight: 500 },
    { id: "p100", label: "You won ₱100", shortLabel: "₱100", amount: 100, weight: 200 },
    { id: "p200", label: "You won ₱200", shortLabel: "₱200", amount: 200, weight: 50 },
    { id: "p1000", label: "You won ₱1,000", shortLabel: "₱1,000", amount: 1000, weight: 10 },
    { id: "p5000", label: "JACKPOT! You won ₱5,000", shortLabel: "₱5,000", amount: 5000, weight: 1 }
  ]
};
