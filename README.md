# @meshsdk/x402

Charge for an API or a page with Cardano. The server answers `402 Payment Required`, the client signs a transaction, a facilitator submits it, and the content is released.

This package implements the Cardano [`exact`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md) scheme of [x402](https://github.com/x402-foundation/x402) v2. Full walkthrough: [meshjs.dev/apis/x402](https://meshjs.dev/apis/x402).

```bash
npm install @meshsdk/x402
```

The client never broadcasts. The price travels in `PAYMENT-REQUIRED`, the signed transaction in `PAYMENT-SIGNATURE`, and the outcome in `PAYMENT-RESPONSE`. You can charge in ada or a CNT.

## Payment methods

Each offer picks one method with `extra.assetTransferMethod`.

**`default`** pays a wallet address. Once the facilitator settles, the funds are already yours.

**`script`** locks the payment at a Plutus script you choose (custom), with an optional datum. x402 checks that the lock went to that script with the datum you declared. Unlocking the script is your contract’s job.

**`masumi`** locks the payment in the Masumi `vested_pay` escrow, under terms the seller signed. Settlement only locks the funds. The seller is paid later, after a result, a refund, or a dispute.

## Facilitator

The facilitator checks a signed transaction, submits it once, and waits for confirmations. It holds no keys and needs no funds — only a Cardano provider.

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

`POST /verify` and `POST /settle` both take `{ paymentPayload, paymentRequirements }`. Pass the server’s own record of the offer, not the copy inside the client’s payload. If they differ, the facilitator returns `REQUIREMENTS_MISMATCH`.

`/settle` claims the transaction id and broadcasts it once. After that you get `confirmed`, `settlement_pending` (retry the same payload; it will not submit again), `duplicate_settlement`, or `EXPIRED`.

## Server

The resource server states a price, remembers what it offered, and serves the content once the facilitator confirms payment. `createPaywall` does all three.

```ts
import {
  buildDefaultOffer,
  createFacilitatorClient,
  createMeshHttpApp,
  createPaywall,
  serveMeshHttp,
} from "@meshsdk/x402";

const paywall = createPaywall({
  network: "cardano:preprod",
  facilitator: createFacilitatorClient("http://localhost:8787"),
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

Build the offer for the method you want:

```ts
buildDefaultOffer({ network, amount, payTo });

buildScriptOffer({
  network,
  amount,
  script: { type: "plutusV3", code: "<hex>" },
  datum: "d8799fff", // optional inline CBOR
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

`fetchWithPayment` works like `fetch`. If the server answers `402`, it builds and signs a payment, retries, and returns the content.

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

If settlement is still pending, send the same `PAYMENT-SIGNATURE` again. Do not build a second payment.

## Withdrawal

How the money leaves depends on the method.

With **`default`**, there is nothing more to do. The payment already sits at `payTo`.

With **`script`**, you spend your own contract: redeemer, validity window, and payouts. Pass an `evaluator` so execution units are estimated.

With **`masumi`**, `/settle` only locks. Funds leave in later transactions against the escrow. The offer sets a clock: the buyer must lock by `payByTime`, the seller must record a result by `submitResultTime`, the seller can withdraw after `unlockTime`, and admins can settle a dispute after `externalDisputeUnlockTime`.

The usual path is lock, then `buildSubmitResultTx` before `submitResultTime`, then `buildWithdrawTx` after `unlockTime`.

```ts
import {
  buildSubmitResultTx,
  buildWithdrawTx,
  parseMasumiLockDatum,
} from "@meshsdk/x402";

const datum = parseMasumiLockDatum(escrowUtxo.output.plutusData)!;
const ctx = { fetcher: provider, evaluator: provider, currentSlot };

const submit = await buildSubmitResultTx(
  escrowUtxo,
  datum,
  resultHashHex,
  sellerWallet,
  deployment,
  ctx,
);
await provider.submitTx(await sellerWallet.signTx(submit));

const withdraw = await buildWithdrawTx(
  nextUtxo,
  nextDatum,
  sellerWallet,
  deployment,
  ctx,
);
await provider.submitTx(await sellerWallet.signTx(withdraw));
```

The other escrow actions:

- Seller records a result with `buildSubmitResultTx`, withdraws with `buildWithdrawTx`, or gives up the claim with `buildAuthorizeRefundTx`.
- Buyer requests a refund with `buildSetRefundRequestedTx` (this becomes a dispute if a result already exists), lets the seller withdraw immediately with `buildAuthorizeWithdrawalTx`, or takes a refund with `buildWithdrawRefundTx`.
- Anyone can settle a dispute after `externalDisputeUnlockTime` with `buildWithdrawDisputedTx`, using an admin CIP-8 quorum (`signAdminIntent`, `verifyAdminSignature`).

Masumi `vested_pay` support is derived from [x402-foundation/x402](https://github.com/x402-foundation/x402) (Apache-2.0).

## License

[Apache License 2.0](./LICENSE)
