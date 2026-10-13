import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const sources = Object.fromEntries(['contracts/ReceiptLink.sol', 'contracts/test/MockUSDC.sol'].map(file => [file, { content: fs.readFileSync(file, 'utf8') }]));
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), {
  import: name => {
    try { return { contents: fs.readFileSync(path.join('node_modules', name), 'utf8') }; }
    catch { return { error: `Import not found: ${name}` }; }
  },
}));
for (const error of output.errors || []) {
  if (error.severity === 'error') { console.error(error.formattedMessage); process.exitCode = 1; }
}
if (process.exitCode) process.exit(process.exitCode);
fs.mkdirSync('artifacts', { recursive: true });
for (const [file, name] of [['contracts/ReceiptLink.sol', 'ReceiptLink'], ['contracts/test/MockUSDC.sol', 'MockUSDC']]) {
  const contract = output.contracts[file][name];
  fs.writeFileSync(`artifacts/${name}.json`, JSON.stringify({
    contractName: name, compilerVersion: solc.version(), abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
  }, null, 2));
}
console.log(`Compiled ReceiptLink and test token with ${solc.version()}`);
