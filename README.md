# @meshsdk/x402

Cardano [`exact`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md) scheme for [x402](https://github.com/x402-foundation/x402) v2. A server answers `402`, the client signs, a facilitator submits, the content unlocks.

Docs: [meshjs.dev/apis/x402](https://meshjs.dev/apis/x402)

```bash
npm install @meshsdk/x402
```

The client never broadcasts. Price is `PAYMENT-REQUIRED`, the signed tx is `PAYMENT-SIGNATURE`, the result is `PAYMENT-RESPONSE`.

## Payment methods

Pick one per offer with `extra.assetTransferMethod`. Asset is `lovelace` or `policyId.assetNameHex`.

| Method | Lock destination | After `/settle` |
| --- | --- | --- |
| `default` | `payTo` address | Funds are already yours |
| `script` | Your Plutus script | You spend the script yourself |
| `masumi` | Masumi `vested_pay` escrow | Later spends: result, refund, dispute |

## Facilitator

Checks the signed tx, submits it once, waits for confirmations. No wallet, no funds.

```ts
import { BlockfrostProvider } from "@meshsdk/provider";
import {
  chainStateFrom,
  createFacilitatorApp,
  InMemorySettlementStore,
  serveMeshHttp,
} from "@meshsdk/x402";

const provider = new BlockfrostProvider("<BLOCKFROST_KEY>");

serveMeshHttp(
  createFacilitatorApp({
    fetcher: provider,
    submitter: provider,
    store: new InMemorySettlementStore(),
    supportedNetworks: ["cardano:preprod"],
    resolveChainState: chainStateFrom(provider),
  }),
  { port: 8787 },
);
```

`POST /verify` and `POST /settle` take `{ paymentPayload, paymentRequirements }`. `paymentRequirements` must be the server's own offer, not the client's copy (`REQUIREMENTS_MISMATCH` otherwise).

`/settle` claims the tx id, broadcasts once, then: `confirmed`, `settlement_pending` (retry the same payload), `duplicate_settlement`, or `EXPIRED`.

## Server

Issue an offer, remember it, release content when the facilitator confirms.

```ts
import {
  buildDefaultOffer,
  buildMasumiOffer,
  buildScriptOffer,
  createFacilitatorClient,
  createMeshHttpApp,
  createPaywall,
  serveMeshHttp,
} from "@meshsdk/x402";

const facilitator = createFacilitatorClient("http://localhost:8787");

const paywall = createPaywall({
  network: "cardano:preprod",
  facilitator,
  issue: () =>
    buildDefaultOffer({
      network: "cardano:preprod",
      amount: "2000000",
      payTo: "addr_test1...",
    }),
  serve: () => Response.json({ ok: true }),
});

const app = createMeshHttpApp();
app.get("/paid", (c) => paywall(c.req.raw));
serveMeshHttp(app, { port: 3000 });
```

```ts
buildDefaultOffer({ network, amount, payTo });

buildScriptOffer({
  network,
  amount,
  script: { type: "plutusV3", code: "<hex>" },
  datum: "d8799fff", // optional inline CBOR; x402 checks it is attached, not that it is correct
});

const { requirements } = await buildMasumiOffer({
  network,
  amount,
  sellerWallet,
  sellerAddress,
  jobInput: { task: "summarize" },
});
```

## Client

```ts
import { MeshWallet } from "@meshsdk/wallet";
import { chainStateFrom, fetchWithPayment } from "@meshsdk/x402";

const wallet = new MeshWallet({
  networkId: 0,
  fetcher: provider,
  submitter: provider,
  key: { type: "mnemonic", words },
});
await wallet.init();

const { protocol, currentSlot } = await chainStateFrom(provider)();
const { response, paymentResponse } = await fetchWithPayment(
  "http://localhost:3000/paid",
  undefined,
  wallet,
  { fetcher: provider, protocol, currentSlot },
);
```

If `/settle` returns `settlement_pending`, resend the same `PAYMENT-SIGNATURE`. Never build a second payment.

## Withdrawal

| Method | How funds leave |
| --- | --- |
| `default` | No second tx. They already sit at `payTo`. |
| `script` | Your contract's spend (redeemer, validity, payouts). Pass an `evaluator`. |
| `masumi` | Lock only. Spend the escrow with the builders below. |

Masumi clock: `payByTime` → `submitResultTime` → `unlockTime` → `externalDisputeUnlockTime`.

Happy path: lock → seller `buildSubmitResultTx` before `submitResultTime` → wait until `unlockTime` → seller `buildWithdrawTx`.

```ts
import { buildSubmitResultTx, buildWithdrawTx, parseMasumiLockDatum } from "@meshsdk/x402";

const datum = parseMasumiLockDatum(escrowUtxo.output.plutusData)!;
const ctx = { fetcher: provider, evaluator: provider, currentSlot };

const submit = await buildSubmitResultTx(escrowUtxo, datum, resultHashHex, sellerWallet, deployment, ctx);
await provider.submitTx(await sellerWallet.signTx(submit));

const withdraw = await buildWithdrawTx(nextUtxo, nextDatum, sellerWallet, deployment, ctx);
await provider.submitTx(await sellerWallet.signTx(withdraw));
```

| Builder | Who | Action |
| --- | --- | --- |
| `buildSubmitResultTx` | seller | Record the result |
| `buildWithdrawTx` | seller | Take funds (`unlockTime`, or after buyer authorize) |
| `buildAuthorizeRefundTx` | seller | Forfeit so the buyer can refund |
| `buildSetRefundRequestedTx` | buyer | Request refund (dispute if a result exists) |
| `buildAuthorizeWithdrawalTx` | buyer | In a dispute, let the seller withdraw now |
| `buildWithdrawRefundTx` | buyer | Take the refund |
| `buildWithdrawDisputedTx` | anyone | Admin CIP-8 quorum (`signAdminIntent`, `verifyAdminSignature`) |

Masumi `vested_pay` support is derived from [x402-foundation/x402](https://github.com/x402-foundation/x402) (Apache-2.0).

## License

[Apache License 2.0](./LICENSE)
