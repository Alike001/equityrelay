import { keccak256, stringToHex } from "viem";

const url = process.env.EQUITYRELAY_BSC_RPC_URL;
if (!url) throw new Error("BSC_RPC_UNAVAILABLE");
const probe = { hash: "0x5516148304443e2461c673f914d3de4140b8f45ef511df05b311fc68c4c55766",
  block: `0x${124836339n.toString(16)}`, market: "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371" };
let requestId = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`RPC_${body.error.code}:${body.error.message}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt === 0 && /(?:429|-32005|timeout|fetch failed)/i.test(String(error))) await new Promise(resolve => setTimeout(resolve, 500));
      else break;
    }
  }
  throw new Error(`${method}: ${String(last)}`);
}

const report = { chain: null, head: null, block: null, transaction: null, receipt: null, finalized: null, boundedLogs: null, errors: [] };
try {
  report.chain = await rpc("eth_chainId", []);
  if (report.chain !== "0x38") throw new Error("WRONG_RPC_CHAIN");
  report.head = await rpc("eth_blockNumber", []);
  const block = await rpc("eth_getBlockByNumber", [probe.block, false]);
  report.block = block?.number ?? null;
  const tx = await rpc("eth_getTransactionByHash", [probe.hash]);
  const receipt = await rpc("eth_getTransactionReceipt", [probe.hash]);
  report.transaction = !!tx && tx.hash === probe.hash && tx.blockHash === block.hash;
  report.receipt = !!receipt && receipt.transactionHash === probe.hash && receipt.blockHash === block.hash;
  const finalized = await rpc("eth_getBlockByNumber", ["finalized", false]);
  report.finalized = finalized?.number ?? null;
  const logs = await rpc("eth_getLogs", [{ address: probe.market,
    topics: [keccak256(stringToHex("Mint(address,uint256,uint256,uint256)"))], fromBlock: probe.block, toBlock: probe.block }]);
  report.boundedLogs = Array.isArray(logs) ? logs.filter(log => log.transactionHash === probe.hash).length : null;
} catch (error) { report.errors.push(`critical: ${String(error)}`); }
console.log(JSON.stringify(report));
if (report.chain !== "0x38" || !report.block || report.transaction !== true || report.receipt !== true ||
    !report.finalized || !report.boundedLogs || report.errors.length) process.exitCode = 1;
