#!/usr/bin/env node
// Read-only cost inputs. This tool has no signing or send method.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { address, AccountRole, createTransactionMessage, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstruction, compileTransaction, blockhash, getAddressDecoder, createAddressWithSeed } from "@solana/kit";
import { SolanaChain } from "../dist/memory/committer-solana.js";
import { PROGRAM_ID, DEVNET_GENESIS, sha256, DREAM_SIZE } from "./chain.ts";
const chain = new SolanaChain(process.env.MEMORY_COMMIT_RPC_URL ?? "https://api.devnet.solana.com");
try {
  if (await chain.rpc("getGenesisHash") !== DEVNET_GENESIS) throw new Error("wrong cluster");
  const binary = await readFile(fileURLToPath(new URL("../../programs/soulbound/target/deploy/soulbound.so", import.meta.url)));
  const get = async (key: string) => (await chain.rpc("getAccountInfo", [key, { encoding: "base64", commitment: "confirmed" }]) as any);
  const program = await get(PROGRAM_ID);
  const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
  if (!program.value?.executable || program.value.owner !== loader || program.value.data[1] !== "base64") throw new Error("wrong program loader");
  const p = Buffer.from(program.value.data[0], "base64");
  if (p.length !== 36 || p.readUInt32LE() !== 2) throw new Error("unexpected program metadata");
  const programData = getAddressDecoder().decode(p.subarray(4, 36));
  const data = await get(programData), bytes = Buffer.from(data.value.data[0], "base64");
  if (data.value.owner !== loader || bytes.readUInt32LE() !== 3 || bytes[12] !== 1) throw new Error("program immutable or unexpected metadata");
  const authority = getAddressDecoder().decode(bytes.subarray(13, 45));
  const payer = process.env.MEMORY_COMMIT_FEE_PAYER ?? authority;
  address(payer);
  const rent = async (n: number) => await chain.rpc("getMinimumBalanceForRentExemption", [n]) as number;
  const requiredProgramDataBytes = Math.max(bytes.length, 45 + binary.length);
  const additionalProgramRent = Math.max(0, await rent(requiredProgramDataBytes) - data.value.lamports);
  const bufferRent = await rent(37 + binary.length);
  // System CreateAccountWithSeed needs only the existing payer/base signer, no new keypair.
  const bufferSeed = `sb006-${sha256(binary).slice(0, 26)}`;
  const buffer = await createAddressWithSeed({ baseAddress: address(payer), programAddress: address(loader), seed: bufferSeed });
  if ((await get(buffer)).value !== null) throw new Error("planned seeded buffer already exists; operator must reconcile before planning another upload");
  const latest = await chain.rpc("getLatestBlockhash", [{ commitment: "confirmed" }]) as any;
  // Quote base fees from a current message; no compute-unit price or signing.
  const quote = async (twoSigners: boolean) => {
    const accounts = [{ address: address(payer), role: AccountRole.WRITABLE_SIGNER }];
    if (twoSigners && payer !== authority) accounts.push({ address: address(authority), role: AccountRole.READONLY_SIGNER });
    const tx = compileTransaction(appendTransactionMessageInstruction({ programAddress: address(loader), accounts, data: new Uint8Array() },
      setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) },
        setTransactionMessageFeePayer(address(payer), createTransactionMessage({ version: 0 })))));
    const result = await chain.rpc("getFeeForMessage", [Buffer.from(tx.messageBytes).toString("base64"), { commitment: "confirmed" }]) as any;
    if (result.value === null) throw new Error("fee unavailable"); return result.value as number;
  };
  const payerOnlyFee = await quote(false), authorityFee = await quote(true);
  // Fixed proposed schedule, not a claim about the CLI's adaptive chunking.
  const uploadChunksAt900Bytes = Math.ceil(binary.length / 900);
  const extendTransactions = requiredProgramDataBytes > bytes.length ? 1 : 0;
  const transactionFeeEstimate = payerOnlyFee * (1 + extendTransactions) + authorityFee * (uploadChunksAt900Bytes + 1);
  console.log(JSON.stringify({ state: "read-only-unapproved-estimate", observedAt: new Date().toISOString(), slot: data.context.slot,
    program: PROGRAM_ID, genesis: DEVNET_GENESIS, programData, authority, payer,
    binaryBytes: binary.length, binarySHA256: sha256(binary), currentProgramCapacity: bytes.length - 45,
    extensionBytes: Math.max(0, binary.length - (bytes.length - 45)), additionalProgramRentLamports: additionalProgramRent,
    buffer, bufferSeed, bufferBase: payer, bufferOwner: loader, bufferAccountAbsent: true,
    proposedSteps: [
      "Atomic System CreateAccountWithSeed + loader InitializeBuffer: exact-sized buffer, authority is the existing upgrade authority; no new keypair.",
      `Loader Write: ${uploadChunksAt900Bytes} ordered transactions, 900-byte chunks at offsets 0,900,..., final chunk shortened to binary length.`,
      `ExtendProgram by ${Math.max(0, binary.length - (bytes.length - 45))} bytes if necessary, with existing payer.`,
      "Loader Upgrade into the pinned program, spill/refund the temporary buffer to the payer; no close/deploy of the program account.",
      "Read back deployed hash/authority/config/assets; do not submit evolve_traits without another exact approval.",
    ],
    temporaryBufferRentLamports: bufferRent, uploadChunksAt900Bytes,
    proposedTransactionCount: 1 + uploadChunksAt900Bytes + extendTransactions + 1, payerOnlyFeeLamports: payerOnlyFee,
    authorityFeeLamports: authorityFee, transactionFeeEstimateLamports: transactionFeeEstimate,
    estimatedPermanentCostLamports: additionalProgramRent + transactionFeeEstimate,
    estimatedPeakLamports: additionalProgramRent + bufferRent + transactionFeeEstimate,
    payerBalanceLamports: (await chain.rpc("getBalance", [payer, { commitment: "confirmed" }]) as any).value,
    firstDreamProvenanceBytes: DREAM_SIZE, firstDreamProvenanceRentLamports: await rent(DREAM_SIZE),
    caveat: "UNAPPROVED proposal only; no buffer/key/transaction created or signed. Fees are current signature-fee quotes, not a simulation of upload transactions; no priority fee assumed. Execution must follow the fixed seeded-buffer/chunk schedule or obtain a new plan approval. Re-read all state/costs before approval. Trait transaction, asset growth rent and any funding are separate approvals.",
  }, null, 2));
} catch { console.error("read-only upgrade estimate failed (RPC/private details suppressed)"); process.exitCode = 1; }
