import { getMarketsDistribution } from "../src/utils/getEpochMarketsDistribution";
import { BigNumber, providers } from "ethers";
import { now } from "../src/helpers";
import { RewardsDistributor__factory } from "@morpho-labs/morpho-ethers-contract";
import addresses from "@morpho-labs/morpho-ethers-contract/lib/addresses";
import { FileSystemStorageService } from "../src/utils/StorageService";
import { SUBGRAPH_URL } from "../src/config";
import { computeBorrowIndex, computeSupplyIndex } from "../src/utils/getUserRewards";
import { MARKETS_UPGRADE_SNAPSHOTS, VERSION_2_TIMESTAMP } from "../src/constants/mechanismUpgrade";
import { Market } from "../src/utils/graph/getGraphMarkets/markets.types";
import { formatGraphMarket } from "../src/utils/graph/getGraphBalances/graphBalances.formatter";
import { getEpoch, ParsedAgeEpochConfig } from "../src";

const storageService = new FileSystemStorageService();

describe("Markets distribution", () => {
  it("Should retrieve the latest market distribution", async () => {
    const marketDistribution = await getMarketsDistribution(storageService);
    expect(marketDistribution).not.toBeUndefined();
  });
  it("Should retrieve the latest market distribution at one given block", async () => {
    const provider = providers.getDefaultProvider();
    const marketDistribution = await getMarketsDistribution(storageService, now(), provider);
    expect(marketDistribution).not.toBeUndefined();
  });
  it("Should include the snapshotProposal field for age3", async () => {
    const marketDistribution = await getMarketsDistribution(storageService, 1672326000);
    console.log(marketDistribution);
    expect(marketDistribution.snapshotProposal).toBeTruthy();
  });
});

describe("Age 1 Epoch 2 approximation", () => {
  let epoch: ParsedAgeEpochConfig;
  const onChainDistribution = require("../distribution/fromDeprecatedScript/proofs-2.json");
  const newDistribution = require("../distribution/age1/epoch2/proofs.json");

  beforeAll(async () => {
    epoch = await getEpoch("age1-epoch2");
  });

  it("Should have the same number of users", () =>
    expect(Object.keys(onChainDistribution.proofs).length).toEqual(Object.keys(newDistribution.proofs).length));

  it("Should contains the same users", () => {
    const newDistriUsers = Object.keys(newDistribution.proofs);
    Object.keys(onChainDistribution.proofs).forEach((onChainUser) => expect(newDistriUsers).toContain(onChainUser));
  });

  it("Should derive of 7e-18 only", () => {
    const newDistriUsers = Object.entries(newDistribution.proofs as Record<string, { amount: string }>);
    Object.entries(onChainDistribution.proofs as Record<string, { amount: string }>).forEach(
      ([onChainUser, onChainDistrib]) => {
        const [, compareTo] = newDistriUsers.find(([u]) => u === onChainUser)!;
        const compareToAmount = BigNumber.from(compareTo.amount);
        const onChainAmount = BigNumber.from(onChainDistrib.amount);
        const dust = compareToAmount.gte(onChainAmount)
          ? compareToAmount.sub(onChainAmount)
          : onChainAmount.sub(compareToAmount);
        // the max derivation from script version one and script version two is 7 * 1e-18 $MORPHO
        expect(dust).toBnLte(7);
      }
    );
  });

  it("Should have the correct root on chain", async () => {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const root = require("../distribution/fromDeprecatedScript/proofs-2.json").root;
    const rewardsDistributor = RewardsDistributor__factory.connect(addresses.morphoDao.rewardsDistributor, provider);
    const onchainRoot = await rewardsDistributor.currRoot({ blockTag: epoch.finalBlock! + 10_000 });
    expect(onchainRoot).toEqual(root);
  });
});

describe.skip("Distribution mechanism v2", () => {
  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);

  it("Should have the correct snapshot at the switch to the new mechanism", async () => {
    const markets = await fetch(SUBGRAPH_URL, {
      method: "POST",
      body: JSON.stringify({
        query: `
        query GetMArkets($block: Int!) {
            markets(first: 100 block: { number: $block }) {
              address
              supplyIndex
              poolSupplyIndex
              p2pSupplyIndex
              supplyUpdateBlockTimestamp
              supplyUpdateBlockTimestampV1
                    
              borrowIndex
              poolBorrowIndex
              p2pBorrowIndex
              borrowUpdateBlockTimestamp
              borrowUpdateBlockTimestampV1
            
              lastPoolSupplyIndex
              lastP2PSupplyIndex
              lastPoolBorrowIndex
              lastP2PBorrowIndex
              lastTotalSupply
              lastTotalBorrow
            
              scaledSupplyOnPool
              scaledSupplyInP2P
              scaledBorrowOnPool
              scaledBorrowInP2P
            }
          }
          `,
        variables: {
          block: 0,
        },
      }),
    })
      .then((res) => res.json())
      .then((markets) => markets.data.markets.map(formatGraphMarket) as Market[]);
    await Promise.all(
      markets.map(async (market) => {
        const supplySnapshot = MARKETS_UPGRADE_SNAPSHOTS.find((s: any) => s.id === `${market.address}-supply`)! as any;
        const supplyIndex = await computeSupplyIndex(market, VERSION_2_TIMESTAMP, provider, storageService);
        // const { p2pSupplyIndex, poolSupplyIndex } = await computeSupplyIndexes(
        //   market,
        //   VERSION_2_TIMESTAMP,
        //   provider,
        //   storageService
        // );
        expect(BigNumber.from(supplySnapshot.indexV1)).toBnEq(supplyIndex);
        const borrowSnapshot = MARKETS_UPGRADE_SNAPSHOTS.find((s: any) => s.id === `${market.address}-borrow`)! as any;
        const borrowIndex = await computeBorrowIndex(market, VERSION_2_TIMESTAMP, provider, storageService);
        // const { p2pBorrowIndex, poolBorrowIndex } = await computeBorrowIndexes(
        //   market,
        //   VERSION_2_TIMESTAMP,
        //   provider,
        //   storageService
        // );
        expect(BigNumber.from(borrowSnapshot.indexV1)).toBnEq(borrowIndex);
      })
    );
  });
});
