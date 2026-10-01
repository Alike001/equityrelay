import { describe,expect,it } from "vitest";
import { summarizeGasEvidence,type ClassifiedGasEvidence } from "./gas-evidence";

const at="2026-09-30T00:00:00.000Z";
describe("classified gas evidence",()=>{
  it("keeps current, historical, proxy, and unavailable evidence explicit",()=>{
    const items:ClassifiedGasEvidence[]=[
      {action:"swap",gasUnits:"100000",classification:"LIVE_CURRENT",observedAt:at,source:"Binance build"},
      {action:"deposit",gasUnits:"200000",classification:"HISTORICAL_CANONICAL",observedAt:at,source:"BSC receipt"},
      {action:"exit",gasUnits:"100000",classification:"PROXY",observedAt:at,source:"similar build"},
      {action:"approval",gasUnits:null,classification:"UNAVAILABLE",observedAt:at,source:"wallet state"},
    ];
    expect(summarizeGasEvidence(items,"1000000000")).toEqual({knownGasUnits:"400000",estimatedCostBNB:"0.0004",recommendedReserveBNB:"0.0008",complete:false});
  });
  it("is complete only when every action has current or canonical evidence",()=>{
    expect(summarizeGasEvidence([{action:"redeem",gasUnits:"231465",classification:"HISTORICAL_CANONICAL",observedAt:at,source:"receipt"}],"1000000000").complete).toBe(true);
  });
});
