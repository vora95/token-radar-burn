// Radar model for token-radar-01 (burn entry @gentle-lynx-64).
//
// Angle: comparables, not a TVL table. The implied value of a protocol that
// records no token is built from the market's own verdict on protocols that
// already trade: the median market-cap-per-TVL multiple of the trading
// protocols in the same DefiLlama category, taken from this snapshot alone.
// That base is then moved by the snapshot's own figures -- seven-day TVL
// growth, how long the protocol has run with no token (maturity), and how
// many chains it runs on -- and haircut by a launch-likelihood factor that
// prices in how unlikely some categories ever are to issue a token at all
// (a CEX or a wrapped product is not a launch candidate, whatever its TVL).
// The board ranks every pre-token protocol in the snapshot (342 rows), not
// just the 40 on the house watchlist, and labels each row watchlist / early /
// long-shot so the reader sees where the house floor ends and our reading
// begins. A protocol records no token; the board never claims it has none.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface ValueBreakdown {
  implied_value_usd: number;
  base_fdv_usd: number;
  multiple: number;
  multiple_source: string;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  likelihood_factor: number;
  likelihood_reason: string;
  age_days: number | null;
  status: 'watchlist' | 'early' | 'long-shot';
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  status: 'watchlist' | 'early' | 'long-shot';
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  multiple_source: string;
  base_fdv_usd: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  likelihood_factor: number;
  likelihood_reason: string;
  comparables: { slug: string; name: string; multiple: number; mcap_usd: number }[];
}

export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols_scanned: number;
    pre_token: number;
    watchlist: number;
    board_rows: number;
    global_multiple: number;
    model: string;
  };
  rows: BoardRow[];
}

const DAY_MS = 86_400_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The snapshot as the house sealed it: 758 protocols, 40 on the watchlist. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** A protocol records no token when DefiLlama carries neither gecko_id nor symbol. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS));
}

/**
 * The market's own multiple, per category: the median mcap_usd / tvl_usd of
 * the trading protocols in that category (at least 3 of them, else the
 * global median across all 128 trading protocols). Clamped to [0.05, 3.0]
 * so one outlier category cannot set the board.
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; n: number }>; global: number } {
  const trading = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const global = median(trading.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, { multiple: number; n: number }>();
  const cats = new Set(trading.map((p) => p.category ?? '(none)'));
  for (const cat of cats) {
    const ratios = trading.filter((p) => (p.category ?? '(none)') === cat).map((p) => p.mcap_usd! / p.tvl_usd);
    if (ratios.length >= 3) byCategory.set(cat, { multiple: clamp(median(ratios), 0.05, 3), n: ratios.length });
  }
  return { byCategory, global: clamp(global, 0.05, 3) };
}

/** The three trading protocols in the same category whose multiple is closest to the category median. */
export function comparablesFor(p: Protocol, snapshot: Snapshot, multiple: number): BoardRow['comparables'] {
  return snapshot.protocols
    .filter((q) => q.mcap_usd !== null && q.mcap_usd > 0 && q.tvl_usd > 0 && (q.category ?? '(none)') === (p.category ?? '(none)') && q.slug !== p.slug)
    .map((q) => ({ slug: q.slug, name: q.name, multiple: q.mcap_usd! / q.tvl_usd, mcap_usd: q.mcap_usd! }))
    .sort((a, b) => Math.abs(a.multiple - multiple) - Math.abs(b.multiple - multiple) || b.mcap_usd - a.mcap_usd)
    .slice(0, 3);
}

const LONG_SHOT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * How likely this protocol ever is to issue a token of its own, from the
 * snapshot's own fields. A CEX, a bridge or a wrapped/staked product is
 * priced as a long shot, not as a launch candidate; everything else keeps
 * its full modeled value.
 */
export function launchLikelihood(p: Protocol): { factor: number; reason: string } {
  const name = p.name;
  if (EXCHANGE_NAMES.some((e) => name.startsWith(e))) {
    return { factor: 0.01, reason: 'Exchange-branded product: a token launch of its own is very unlikely, priced at 1% of modeled value.' };
  }
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(name)) {
    return { factor: 0.02, reason: 'Wrapped or staked product of a token that already trades, not a fresh launch, priced at 2% of modeled value.' };
  }
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(name)) {
    return { factor: 0.1, reason: 'Versioned deployment (V2/2.0): the parent protocol, not this deployment, would launch, priced at 10%.' };
  }
  if (p.category === 'CEX') return { factor: 0.01, reason: 'Centralised exchange: no on-chain token launch to farm, priced at 1% of modeled value.' };
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge' || p.category === 'Cross Chain Bridge') {
    return { factor: 0.01, reason: 'Bridge: moves other chains’ tokens, it does not launch one of its own, priced at 1% of modeled value.' };
  }
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') {
    return { factor: 0.02, reason: 'Liquid staking/restaking receipt token: the underlying asset already trades, priced at 2% of modeled value.' };
  }
  if (p.category === 'Staking Pool') return { factor: 0.1, reason: 'Staking pool: a launch is possible but the pool is a wrapper, not a protocol, priced at 10%.' };
  if (p.category === 'Chain') return { factor: 0.5, reason: 'Chain-level protocol: a token is possible, but chain launches follow their own rules.' };
  return { factor: 1, reason: 'Standalone protocol in a launchable category.' };
}

/** The implied value and every factor behind it, from the snapshot's figures alone. */
export function valueModel(
  p: Protocol,
  multiples: { byCategory: Map<string, { multiple: number; n: number }>; global: number },
  watchlist: Set<string>,
  asOf: string,
): ValueBreakdown {
  const catKey = p.category ?? '(none)';
  const cat = multiples.byCategory.get(catKey);
  const multiple = cat !== undefined ? cat.multiple : multiples.global;
  const multiple_source = cat !== undefined ? `median of ${cat.n} trading ${p.category ?? 'uncategorised'} protocols` : 'global median of 128 trading protocols';
  const base_fdv_usd = p.tvl_usd * multiple;

  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -40, 80);
  const growth_factor = p.change_7d === null ? 1 : 1 + (growth / 100) * 0.6;

  const age_days = p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
  const maturity_factor = age_days === null ? 1 : 1 + Math.min(age_days / 365, 5) * 0.05;

  const breadth_factor = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 4);

  const { factor: likelihood_factor, reason: likelihood_reason } = launchLikelihood(p);

  const implied_value_usd = Math.max(1, Math.round(base_fdv_usd * growth_factor * maturity_factor * breadth_factor * likelihood_factor));

  const status: ValueBreakdown['status'] = watchlist.has(p.slug)
    ? 'watchlist'
    : likelihood_factor < 1
      ? 'long-shot'
      : 'early';

  return { implied_value_usd, base_fdv_usd: Math.round(base_fdv_usd), multiple, multiple_source, growth_factor, maturity_factor, breadth_factor, likelihood_factor, likelihood_reason, age_days, status };
}

// ---------------------------------------------------------------- farm plans

interface FarmCtx {
  name: string;
  chain: string;
  category: string;
  tvl: string;
}

const fmt = (template: string, ctx: FarmCtx): string =>
  template.replaceAll('{name}', ctx.name).replaceAll('{chain}', ctx.chain).replaceAll('{category}', ctx.category).replaceAll('{tvl}', ctx.tvl);

const GENERIC: string[] = [
  'Open {name} on {chain} with a fresh wallet funded with $50–100 plus gas; budget $3–10 per action on {chain} and 20–30 minutes to set up your first position.',
  'Use the protocol’s core {category} action once a week for at least 4 weeks: repeat on-chain use, not one deposit, is what past airdrops have weighted most.',
  'Keep $20–50 of value working in the protocol through the whole period instead of depositing and withdrawing the same day; snapshot-style checks reward staying, not flashing.',
  'Do one different action each visit (deposit, then swap or borrow, then withdraw a little) so your address shows breadth of use across the protocol’s features.',
  'Record every transaction hash, the date and the gas you paid in a note; if {name} ever opens a claim, you will need the history to prove you were early.',
];

const PLAYBOOKS: Record<string, string[]> = {
  Dexs: [
    'Open {name} on {chain} and swap $25–50 into two different tokens; budget $2–8 gas per swap on {chain} and 15 minutes for your first trade.',
    'Add $50–100 of liquidity to one pool for at least 2 weeks; a ranged or concentrated position that stays in range counts more than a deposit you pull the next day.',
    'Swap again once a week for 4 weeks, varying the pair and the size ($10–100), so your address shows repeat trader activity rather than a single trade.',
    'If {name} has a points or volume program, opt in before you trade and check your points after each week; record the running total in a note.',
    'Leave the liquidity in place for a full month, then withdraw half and keep the rest working; exiting everything at once has historically read as farming-and-dumping.',
  ],
  Lending: [
    'Deposit $50–100 of a blue-chip asset (ETH, USDC or wBTC) as collateral on {name} on {chain}; budget $3–10 gas per action and 20 minutes for the first deposit.',
    'Borrow $10–30 against that collateral (under 40% of its value, so no liquidation risk) and repay it within a week; borrow-and-repay cycles are the activity lenders track.',
    'Repeat the deposit-and-borrow loop once a week for 4–6 weeks, changing the borrowed asset at least once, and never let the health factor drop below 1.5.',
    'If {name} supports looping or a second market on {chain}, try one small loop ($20–40) to show depth of use; stop if the borrow rate jumps above 10% APR.',
    'Keep the collateral deposited for at least a month and keep a note of each transaction hash and date; a claim, if one ever opens, will ask for this history.',
  ],
  Yield: [
    'Deposit $50–100 into {name}’s highest-TVL vault on {chain}; budget $3–10 gas per action and 20 minutes to read the vault’s strategy first.',
    'Leave the deposit compounding for at least 4 weeks without touching it; yield vaults reward time-in-vault, and early exits are usually worth nothing.',
    'Add a second, smaller deposit ($20–30) in week 2 into a different vault so your address shows use of more than one product.',
    'Check the vault’s APY weekly and move only if it falls below half its starting rate; chasing every new vault burns gas and resets your tenure.',
    'Note the deposit dates, amounts and transaction hashes; if a token ever launches, tenure and total deposits are the usual allocation inputs.',
  ],
  'Yield Aggregator': [
    'Deposit $50–100 into {name} on {chain} through its auto-compounding vault; budget $3–10 gas and 20 minutes to compare its vaults first.',
    'Leave the deposit untouched for 4–6 weeks so compounding and tenure build; aggregators have historically rewarded stayers, not rotators.',
    'Try a second vault or strategy ($20–30) in week 3 to show breadth, and keep both positions open at the same time.',
    'Claim or restake any rewards the vault pays at least once, even if small, so your address has a claim event on record.',
    'Keep a note of deposit dates, vault names and transaction hashes; allocation math, if a launch ever happens, starts from this history.',
  ],
  RWA: [
    'Open {name} on {chain} and complete any identity or allowlist step it requires; this takes 10–30 minutes and usually costs nothing but a signature.',
    'Buy or mint $50–100 of its tokenised asset (T-bill, credit or real-estate share) and hold it for at least 30 days; RWA programs reward holders, not flippers.',
    'Reinvest or top up $20–30 once in the first month so your address shows repeat participation rather than a single purchase.',
    'If {name} pays yield, claim it once and restake or hold the proceeds instead of selling; a claim event plus a hold is the strongest on-chain signal here.',
    'Save the purchase receipts, dates and transaction hashes; RWA launches, when they happen, usually weight holding time over trade count.',
  ],
  Derivatives: [
    'Fund a fresh wallet with $100–150 on {chain} and open a small $20–50 perpetual or options position on {name}; budget $3–10 gas per trade and 30 minutes to learn the interface.',
    'Trade once a week for 4–6 weeks with $10–50 per trade and keep leverage at 2x or below so a normal move cannot liquidate you.',
    'Use two different markets (for example ETH and BTC, or a perp and an option) so your address shows breadth across the protocol’s products.',
    'Close each position deliberately rather than letting it liquidate; a liquidation on record is a bad look for any future allocation.',
    'Record every trade’s size, market and transaction hash; volume and weeks-active are the two numbers derivatives airdrops have weighted most.',
  ],
  CDP: [
    'Deposit $50–100 of collateral (ETH or wBTC) into {name} on {chain} and mint $20–40 of its stable asset; keep the collateral ratio above 200% at all times.',
    'Hold the minted stable asset for at least 2 weeks instead of selling it immediately; CDP protocols reward minters who keep the system solvent.',
    'Repay a small part ($5–10) in week 2 and mint again, so your address shows an active borrow-and-repay cycle rather than a one-off mint.',
    'If {name} has a stability pool or savings module, deposit $10–20 there as well to show use of a second feature.',
    'Note the collateral amounts, mint dates and transaction hashes; a future allocation, if any, will likely weight minted amount times days held.',
  ],
  Restaking: [
    'Restake $50–100 of ETH or a liquid staking token through {name} on {chain}; budget $5–15 gas per action and 30 minutes to read the operator and slashing terms.',
    'Choose an operator or vault and leave the position untouched for at least 6 weeks; restaking rewards tenure and punishes hopping between operators.',
    'If {name} issues points, check your points balance weekly and note it; points have been the allocation input for every restaking launch so far.',
    'Add a second small deposit ($20–30) in week 3 rather than moving the first one, so your history shows accumulation, not rotation.',
    'Keep a record of deposit dates, amounts, operator and transaction hashes; restaking claims are usually proportional to points, which are proportional to time.',
  ],
  Bridge: [
    'Bridge $50–100 from {chain} to one other chain through {name}; budget $5–15 gas plus the bridge fee and 20–30 minutes for the transfer to finalise.',
    'Bridge back a smaller amount ($20–30) a week later, so your address shows two-way use rather than a single one-way transfer.',
    'Repeat once a week for a month, varying the destination chain at least once; bridges have historically weighted repeat users over one-off volume.',
    'Use the bridge’s own interface (not an aggregator) for at least half your transfers so the activity is visible on {name} itself.',
    'Save every transaction hash and the source and destination chains; if a token ever launches, weeks-active and chains-used are the usual inputs.',
  ],
  CEX: [
    'This is a centralised exchange, so there is no on-chain farm: create an account, finish verification (10–30 minutes) and deposit $50–100 to trade.',
    'Trade $20–50 a week for 4 weeks on the spot market and keep the balance on the exchange; activity, not withdrawals, is what exchange programs count.',
    'Try one second product (staking, earn or a launchpad hold) with $10–20 so your account shows more than spot trading alone.',
    'Do not expect an on-chain airdrop here: any reward would come through the exchange’s own program, so check its announcements weekly.',
    'Keep your deposit and trade history; if the exchange ever runs a token event, account age and volume are the usual qualifiers.',
  ],
  Chain: [
    'Bridge $50–100 to this chain and fund a fresh wallet with its gas token; budget $5–15 for the bridge and 20 minutes to set the wallet up.',
    'Use the chain’s flagship apps once a week for a month ($10–30 per action): a swap, a deposit and one native app, so your address is active across the ecosystem.',
    'Hold a small balance ($20–50) on the chain for the whole month instead of bridging it straight back; chain airdrops have rewarded residents, not tourists.',
    'Try the chain’s own staking or governance feature once, even with $10, to show you use the chain itself and not only its apps.',
    'Record the bridge date, the apps you used and the transaction hashes; a chain-level launch, if one ever comes, starts from this activity.',
  ],
  'Risk Curators': [
    'Deposit $50–100 into a vault curated on {name} on {chain}; budget $3–10 gas and 20 minutes to read who curates it and what the caps are.',
    'Leave the deposit for at least 4 weeks; curator vaults reward allocators who stay through a full market cycle, not depositors who exit in days.',
    'Try a second curator’s vault ($20–30) in week 3 so your address shows you evaluated curators rather than blindly picking one.',
    'Check the vault’s allocation and APY weekly and move only if a cap changes or the APY halves; frequent moves reset your tenure.',
    'Note the vault, curator, dates and transaction hashes; curator launches, when they happen, usually weight time-in-vault per curator.',
  ],
  'Basis Trading': [
    'Deposit $50–100 into {name}’s basis vault on {chain}; budget $3–10 gas and 20 minutes to understand the delta-neutral strategy first.',
    'Hold the position for at least 4 weeks; basis strategies earn funding-rate yield over time, and early exits capture almost none of it.',
    'Add $20–30 in week 3 to show accumulation, and claim any yield the vault pays at least once during the month.',
    'Watch the vault’s funding rate weekly; if it turns negative for two weeks running, consider exiting half rather than the whole position.',
    'Record deposit dates, amounts and transaction hashes; tenure and total deposited are the usual allocation inputs for a launch.',
  ],
  Payments: [
    'Fund a wallet with $50–100 on {chain} and pay for one real thing through {name} (a transfer, a bill or a merchant payment); budget $1–5 gas and 15 minutes.',
    'Repeat the payment once a week for a month, varying the recipient or the amount ($10–50), so your address shows habitual use, not a test.',
    'If {name} has a card or rewards program, enrol (10 minutes, usually free) and use it for at least two payments during the month.',
    'Keep a small balance ($20–30) in the payment wallet for the whole month rather than emptying it after each payment.',
    'Save the payment receipts, dates and transaction hashes; payment protocols, when they launch, have weighted repeat users over one-off volume.',
  ],
  'Prediction Market': [
    'Fund a wallet with $50–100 on {chain} and place a $5–20 prediction on {name} in a market you understand; budget $1–5 gas and 15 minutes per bet.',
    'Bet once a week for 4–6 weeks across at least three different markets, keeping each stake small so no single loss matters.',
    'Claim any winnings promptly and redeploy half of them into a new market; a claim event plus redeployment is the strongest activity signal here.',
    'Provide $20–30 of liquidity to one market if {name} supports it, and leave it until that market resolves.',
    'Record each market, stake, outcome and transaction hash; volume, markets traded and weeks active are the usual allocation inputs.',
  ],
  'Liquidity Manager': [
    'Deposit $50–100 into a managed liquidity position on {name} on {chain}; budget $3–10 gas and 20 minutes to pick a pool and a range.',
    'Leave the position managed for at least 4 weeks; managers rebalance for you, and withdrawing early wastes the fees you paid to enter.',
    'Add $20–30 in week 3 to show accumulation, and check the position’s range and fees weekly without touching it.',
    'If the manager offers auto-compounding, turn it on once and leave it on; a compounding event on record shows you used the product properly.',
    'Note the pool, deposit dates and transaction hashes; managed-liquidity launches usually weight time-in-position and fees earned.',
  ],
  Insurance: [
    'Buy $20–50 of cover on {name} on {chain} for a protocol you already use; budget $3–10 gas and 20 minutes to read what the cover actually pays.',
    'Hold the cover for its full term (usually 30–90 days) instead of cancelling early; cover buyers who stay are the ones insurance programs reward.',
    'If {name} lets you underwrite, stake $20–30 in an underwriting pool as well to show both sides of the market.',
    'File nothing unless a real incident happens; a fraudulent claim would end any future allocation and possibly your account.',
    'Save the policy dates, premium and transaction hash; insurance launches, when they happen, weight cover bought and time held.',
  ],
  'Options Vault': [
    'Deposit $50–100 into an options vault on {name} on {chain}; budget $3–10 gas and 20 minutes to read the strike, expiry and settlement rules.',
    'Leave the deposit for a full epoch (usually 1–4 weeks) so it earns the option premium; withdrawing mid-epoch forfeits most of it.',
    'Try a second vault or expiry ($20–30) in the next epoch so your address shows repeat use across epochs, not a single deposit.',
    'Claim any premium or yield the vault pays at the end of each epoch, even if small, so you have claim events on record.',
    'Record the vault, epoch dates and transaction hashes; options launches usually weight epochs participated in and total deposited.',
  ],
  Privacy: [
    'Fund a fresh wallet with $50–100 on {chain} and make one private transfer or shielded deposit through {name}; budget $3–10 gas and 20 minutes to learn the flow.',
    'Use the protocol once a week for a month with $10–30 per action, varying the amount so the activity looks like real use, not a test loop.',
    'If {name} has a shielded pool or private vault, keep $20–50 in it for at least 2 weeks rather than depositing and withdrawing the same day.',
    'Never use the protocol to obscure funds you cannot explain; a future claim will ask for the history, and clean history is the whole point.',
    'Note the dates, amounts and transaction hashes in a private note; privacy launches weight weeks active, which only your own records can prove.',
  ],
  Farm: [
    'Deposit $50–100 into {name}’s farm on {chain} and stake the LP or receipt token; budget $3–10 gas and 20 minutes to set it up.',
    'Leave the stake for at least 4 weeks and harvest rewards once a week, restaking half of each harvest to show compounding behaviour.',
    'Try a second pool ($20–30) in week 3 so your address shows breadth across the farm’s pools.',
    'Watch the pool’s emission rate weekly; if it drops by more than half, move only half your stake and keep the rest earning.',
    'Record the pools, deposit dates and transaction hashes; farm launches usually weight stake size times days staked.',
  ],
  Indexes: [
    'Buy $50–100 of {name}’s index token on {chain}; budget $3–10 gas and 20 minutes to read what the index holds and how it rebalances.',
    'Hold the index for at least 4 weeks without selling; index products reward holders, and rebalancing already happens inside the token.',
    'Add $20–30 in week 3 to show accumulation, and check the index composition once a week so you know what you hold.',
    'If the index pays yield or lets you stake it, stake $20–30 of it once to show a second layer of use.',
    'Note the purchase dates, amounts and transaction hashes; index launches usually weight holding time over trade count.',
  ],
  'Collateral Markets': [
    'Deposit $50–100 of collateral into {name} on {chain} and borrow $20–40 against it; keep the collateral ratio above 200% so no liquidation can touch you.',
    'Hold the borrow for at least 2 weeks, repay $10 in week 2 and borrow again, so your address shows a live borrow cycle rather than a one-off.',
    'Try a second collateral asset ($20–30) in week 3 to show breadth across the market’s collateral types.',
    'If {name} has a rewards or points program, opt in before your first borrow and check the balance weekly.',
    'Record the collateral, borrow amounts, dates and transaction hashes; a launch, if one ever comes, will weight borrowed amount times days active.',
  ],
};

/** Concrete farm steps for one protocol: the category playbook, else the generic plan. */
export function farmPlan(p: Protocol): string[] {
  const ctx: FarmCtx = {
    name: p.name,
    chain: p.chains[0] ?? 'Ethereum',
    category: p.category ?? 'protocol',
    tvl: `$${Math.round(p.tvl_usd / 1_000_000)}M`,
  };
  const templates = PLAYBOOKS[p.category ?? ''] ?? GENERIC;
  return templates.map((t) => fmt(t, ctx));
}

// ---------------------------------------------------------------- board build

export interface RadarBuild {
  board: BoardRow[];
  radar: RadarData;
}

/** Every pre-token protocol in the snapshot, ranked by implied value. */
export function buildRadar(snapshot: Snapshot): RadarBuild {
  const multiples = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(recordsNoToken);
  const scored = preToken.map((p) => {
    const model = valueModel(p, multiples, watchlist, snapshot.as_of);
    return {
      p,
      model,
      comparables: comparablesFor(p, snapshot, model.multiple),
      farm_steps: farmPlan(p),
    };
  });
  scored.sort((a, b) => b.model.implied_value_usd - a.model.implied_value_usd || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.model.implied_value_usd,
    farm_steps: s.farm_steps,
    status: s.model.status,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.model.age_days,
    multiple: s.model.multiple,
    multiple_source: s.model.multiple_source,
    base_fdv_usd: s.model.base_fdv_usd,
    growth_factor: s.model.growth_factor,
    maturity_factor: s.model.maturity_factor,
    breadth_factor: s.model.breadth_factor,
    likelihood_factor: s.model.likelihood_factor,
    likelihood_reason: s.model.likelihood_reason,
    comparables: s.comparables,
  }));
  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols_scanned: snapshot.protocols.length,
      pre_token: preToken.length,
      watchlist: snapshot.watchlist.length,
      board_rows: board.length,
      global_multiple: multiples.global,
      model: 'implied = TVL x category median mcap/TVL x growth x maturity x breadth x launch-likelihood',
    },
    rows: board,
  };
  return { board, radar };
}

/** The dashboard's data file: window.__RADAR__ beside the page. */
export function dataScript(radar: RadarData): string {
  return `window.__RADAR__ = ${JSON.stringify(radar)};\n`;
}

/** The gate's own shape, checked before anything is written: null when the board passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not a snapshot protocol`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} holds ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `row ${row.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `ranks are not 1 to ${board.length} once each`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises as rank ascends';
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1 && board.length > 1) return 'every implied value is the same';
  return null;
}
