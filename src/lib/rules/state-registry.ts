/**
 * State rule-pack registry.
 *
 * Phase 1 ships the registry structure for all 50 states + DC with every pack
 * marked NOT_LOADED. Nothing state-specific is asserted until a pack has been
 * researched against the state's official sources and approved by a reviewer
 * (Phase 2). Until then the engine reports UNABLE_TO_DETERMINE for
 * state-dependent items instead of guessing.
 */

export interface StateAdoption {
  citation: string;
  url: string;
  lastVerified: string;
}

export interface StatePack {
  code: string;
  name: string;
  status: "NOT_LOADED" | "LOADED";
  /** Topics this pack covers once loaded, e.g. "new-hire reporting", "intrastate DQ adoption". */
  topics: string[];
  /** Map of federal rule id -> state citation adopting it for intrastate carriers. */
  adoptions: Record<string, StateAdoption>;
}

export interface StateRegistry {
  get(code: string): StatePack | undefined;
  lookupAdoption(code: string, ruleId: string): StateAdoption | undefined;
  all(): StatePack[];
}

export const JURISDICTIONS: Array<[string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

export function createStateRegistry(packs: StatePack[]): StateRegistry {
  const byCode = new Map(packs.map((p) => [p.code, p]));
  return {
    get: (code) => byCode.get(code),
    lookupAdoption: (code, ruleId) => {
      const p = byCode.get(code);
      return p && p.status === "LOADED" ? p.adoptions[ruleId] : undefined;
    },
    all: () => [...byCode.values()],
  };
}

export const stateRegistry: StateRegistry = createStateRegistry(
  JURISDICTIONS.map(([code, name]) => ({ code, name, status: "NOT_LOADED", topics: [], adoptions: {} })),
);
