import { UTxO } from "@meshsdk/common";
import { MeshWallet } from "@meshsdk/wallet";

import { MASUMI_STATE, MasumiDatumView } from "../../src/masumi/datum";
import { MASUMI_DEFAULT_DEPLOYMENT } from "../../src/masumi/escrow-address";
import { buildSubmitResultTx, buildWithdrawTx } from "../../src/masumi/spend";
import { SpendContext } from "../../src/masumi/spend/context";

// The guards run before any chain access, so inert stubs are enough.
const utxo = {} as UTxO;
const wallet = {} as MeshWallet;
const ctx = {} as SpendContext;
const now = Date.now();

const datum = (over: Partial<MasumiDatumView>): MasumiDatumView =>
  ({
    resultHash: "",
    submitResultTime: BigInt(now + 60_000),
    unlockTime: BigInt(now + 120_000),
    externalDisputeUnlockTime: BigInt(now + 180_000),
    state: MASUMI_STATE.FundsLocked,
    ...over,
  }) as MasumiDatumView;

const submit = (d: MasumiDatumView) =>
  buildSubmitResultTx(utxo, d, "aa", wallet, MASUMI_DEFAULT_DEPLOYMENT, ctx);
const withdraw = (d: MasumiDatumView) =>
  buildWithdrawTx(utxo, d, wallet, MASUMI_DEFAULT_DEPLOYMENT, ctx);

describe("Masumi spend guards fail fast with a readable error", () => {
  it("SubmitResult after submit_result_time", async () => {
    await expect(
      submit(datum({ submitResultTime: BigInt(now - 1000) })),
    ).rejects.toMatchObject({ code: "MASUMI_SPEND_DEADLINE_PASSED" });
  });

  it("SubmitResult revision after external_dispute_unlock_time", async () => {
    await expect(
      submit(
        datum({
          resultHash: "ab",
          state: MASUMI_STATE.ResultSubmitted,
          externalDisputeUnlockTime: BigInt(now - 1000),
        }),
      ),
    ).rejects.toMatchObject({ code: "MASUMI_SPEND_DEADLINE_PASSED" });
  });

  it("SubmitResult from a state that cannot submit", async () => {
    await expect(
      submit(datum({ state: MASUMI_STATE.WithdrawAuthorized })),
    ).rejects.toMatchObject({ code: "MASUMI_SPEND_INVALID_STATE" });
  });

  it("Withdraw before unlock_time", async () => {
    await expect(
      withdraw(datum({ state: MASUMI_STATE.ResultSubmitted })),
    ).rejects.toMatchObject({ code: "MASUMI_SPEND_NOT_YET_OPEN" });
  });

  it("Withdraw from FundsLocked (never submitted a result)", async () => {
    await expect(withdraw(datum({}))).rejects.toMatchObject({
      code: "MASUMI_SPEND_INVALID_STATE",
    });
  });
});
