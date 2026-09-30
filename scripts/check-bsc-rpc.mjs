import { keccak256, stringToHex } from "viem";

const url = process.env.EQUITYRELAY_BSC_RPC_URL;
if (!url) throw new Error("BSC_RPC_UNAVAILABLE");
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
  let block;
  for (let offset = 0; offset < 5; offset++) {
    const number = Number.parseInt(report.head, 16) - offset;
    block = await rpc("eth_getBlockByNumber", [`0x${number.toString(16)}`, false]);
    if (block?.transactions?.length) break;
  }
  report.block = block?.number ?? null;
  const hash = block?.transactions?.[0];
  if (hash) {
    const tx = await rpc("eth_getTransactionByHash", [hash]);
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    report.transaction = !!tx && tx.hash === hash;
    report.receipt = !!receipt && receipt.transactionHash === hash && receipt.blockHash === block.hash;
  }
  try { const finalized = await rpc("eth_getBlockByNumber", ["finalized", false]); report.finalized = finalized?.number ?? null; }
  catch (error) { report.errors.push(`finalized: ${String(error)}`); }
  try {
    const logs = await rpc("eth_getLogs", [{ address: "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371",
      topics: [keccak256(stringToHex("Mint(address,uint256,uint256,uint256)"))], fromBlock: report.block, toBlock: report.block }]);
    report.boundedLogs = Array.isArray(logs) ? logs.length : null;
  } catch (error) { report.errors.push(`boundedLogs: ${String(error)}`); }
} catch (error) { report.errors.push(`critical: ${String(error)}`); }
console.log(JSON.stringify(report));
if (report.chain !== "0x38" || !report.block || report.transaction !== true || report.receipt !== true) process.exitCode = 1;
