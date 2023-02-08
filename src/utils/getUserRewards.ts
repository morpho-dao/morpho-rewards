import { BigNumber, BigNumberish, constants, providers } from "ethers";
import { maxBN, minBN, now, WAD } from "../helpers";
import { UserBalance } from "./graph";
import { Market } from "./graph/getGraphMarkets/markets.types";
import { getEpochsBetweenTimestamps, getPrevEpoch, timestampToEpoch } from "./timestampToEpoch";
import { RewardsDistributor__factory } from "@morpho-labs/morpho-ethers-contract";
import addresses from "@morpho-labs/morpho-ethers-contract/lib/addresses";
import { getCurrentOnChainDistribution } from "./getCurrentOnChainDistribution";
import { getEpochMarketsDistribution } from "./getEpochMarketsDistribution";
import { SUBGRAPH_URL } from "../config";
import { PercentMath, WadRayMath } from "@morpho-labs/ethers-utils/lib/maths";
import { Provider } from "@ethersproject/providers";
import { cloneDeep } from "lodash";
import { getUserBalances } from "./getUserBalances";

export const VERSION_2_TIMESTAMP = BigNumber.from(1675263600);

export const getUserRewards = async (
  address: string,
  blockNumber?: number,
  provider: providers.Provider = new providers.InfuraProvider(1)
) => {
  let timestampEnd = now();
  if (blockNumber) {
    const block = await provider.getBlock(blockNumber);
    timestampEnd = block.timestamp;
  }
  const userBalances = await getUserBalances(SUBGRAPH_URL, address.toLowerCase(), blockNumber);
  const currentEpoch = timestampToEpoch(timestampEnd);
  await getEpochMarketsDistribution(currentEpoch!.epoch.id, provider); // preload to cache the current epoch configuration
  // to prevent parallel fetching of the same data
  const currentRewards = sumRewards(
    await userBalancesToUnclaimedTokens(userBalances?.balances || [], timestampEnd, provider)
  );
  const onChainDistribution = await getCurrentOnChainDistribution(provider, blockNumber);
  const claimableRaw = onChainDistribution.proofs[address.toLowerCase()];
  const claimable = claimableRaw ? BigNumber.from(claimableRaw.amount) : BigNumber.from(0);
  const prevEpoch = getPrevEpoch(currentEpoch?.epoch.id);
  let claimableSoon = BigNumber.from(0);
  if (prevEpoch && prevEpoch.epoch.id !== onChainDistribution.epoch) {
    // The previous epoch is done, but the root is not yet modified on chain
    // So The difference between the amùount of the previous epoch and the amount claimable on chain will be claimable soon,
    // When the root will be updated by DAO
    const prevId = prevEpoch.epoch.number;
    const prevDistribution = require(`../../distribution/proofs/proofs-${prevId}.json`);
    const claimableSoonRaw = prevDistribution.proofs[address.toLowerCase()];
    if (claimableSoonRaw) {
      claimableSoon = BigNumber.from(claimableSoonRaw.amount).sub(claimable);
    }
  }
  const currentEpochRewards = currentRewards.sub(claimable).sub(claimableSoon);

  let currentEpochProjectedRewards = currentRewards;
  if (currentEpoch?.epoch.finalTimestamp)
    currentEpochProjectedRewards = sumRewards(
      await userBalancesToUnclaimedTokens(userBalances?.balances || [], currentEpoch.epoch.finalTimestamp, provider)
    )
      .sub(claimable)
      .sub(claimableSoon);

  let claimed = BigNumber.from(0);
  let claimData = {};
  if (claimable.gt(0)) {
    const rewardsDisributor = RewardsDistributor__factory.connect(addresses.morphoDao.rewardsDistributor, provider);
    claimed = await rewardsDisributor.claimed(address);
    claimData = claimable.sub(claimed).gt(0)
      ? {
          root: onChainDistribution.root,
          rewardsDistributor: rewardsDisributor.address,
          functionSignature: "claim(address,uint256,bytes32[])",
          args: {
            address,
            amount: claimableRaw!.amount,
            proof: claimableRaw!.proof,
          },
          encodedData: await rewardsDisributor.populateTransaction
            .claim(address, claimableRaw!.amount, claimableRaw!.proof)
            .then((r) => r.data),
        }
      : {};
  }
  return {
    currentEpochRewards,
    currentEpochProjectedRewards,
    totalRewardsEarned: currentRewards,
    claimable,
    claimableSoon,
    claimedRewards: claimed,
    claimData,
  };
};

export interface MarketRewards {
  market: Market;
  accumulatedSupplyV1: BigNumber;
  accumulatedSupplyV2: BigNumber;
  accumulatedSupply: BigNumber;
  accumulatedBorrowV1: BigNumber;
  accumulatedBorrowV2: BigNumber;
  accumulatedBorrow: BigNumber;
}
export const userBalancesToUnclaimedTokens = async (
  balances: UserBalance[],
  currentTimestamp: BigNumberish,
  provider: providers.Provider
): Promise<MarketRewards[]> => {
  const ts = BigNumber.from(currentTimestamp);
  return Promise.all(
    balances.map(async (b) => {
      let balance = b;
      let accumulatedSupplyV1 = b.accumulatedSupplyMorphoV1;
      let accumulatedSupplyV2 = b.accumulatedSupplyMorphoV2;
      let accumulatedSupply = b.accumulatedSupplyMorpho;
      let accumulatedBorrowV1 = b.accumulatedBorrowMorphoV1;
      let accumulatedBorrowV2 = b.accumulatedBorrowMorphoV2;
      let accumulatedBorrow = b.accumulatedBorrowMorpho;
      if (b.market.supplyUpdateBlockTimestamp.lt(VERSION_2_TIMESTAMP) && ts.gte(VERSION_2_TIMESTAMP)) {
        // compute twice when upgrading to v2 distribution mechanism
        const { updatedBalance, accruedSupplyV1, accruedSupplyV2 } = await accrueSupplyRewards(
          b,
          VERSION_2_TIMESTAMP,
          provider
        );
        accumulatedSupplyV1 = accumulatedSupplyV1.add(accruedSupplyV1);
        accumulatedSupplyV2 = accumulatedSupplyV2.add(accruedSupplyV2);
        accumulatedSupply = accumulatedSupply.add(accruedSupplyV1);
        balance = updatedBalance;
        const {
          updatedBalance: updatedBalanceBorrow,
          accruedBorrowV1,
          accruedBorrowV2,
        } = await accrueBorrowRewards(balance, VERSION_2_TIMESTAMP, provider);
        accumulatedBorrowV1 = accumulatedBorrowV1.add(accruedBorrowV1);
        accumulatedBorrowV2 = accumulatedBorrowV2.add(accruedBorrowV2);
        accumulatedBorrow = accumulatedBorrow.add(accruedBorrowV1);
        balance = updatedBalanceBorrow;
      }

      const { accruedSupplyV1, accruedSupplyV2 } = await accrueSupplyRewards(balance, ts, provider);

      accumulatedSupplyV1 = accumulatedSupplyV1.add(accruedSupplyV1);
      accumulatedSupplyV2 = accumulatedSupplyV2.add(accruedSupplyV2);
      if (ts.gt(VERSION_2_TIMESTAMP)) accumulatedSupply = accumulatedSupply.add(accruedSupplyV2);
      else accumulatedSupply = accumulatedSupply.add(accruedSupplyV1);

      const { accruedBorrowV1, accruedBorrowV2 } = await accrueBorrowRewards(balance, ts, provider);
      accumulatedBorrowV1 = accumulatedBorrowV1.add(accruedBorrowV1);
      accumulatedBorrowV2 = accumulatedBorrowV2.add(accruedBorrowV2);

      if (ts.gt(VERSION_2_TIMESTAMP)) accumulatedBorrow = accumulatedBorrow.add(accruedBorrowV2);
      else accumulatedBorrow = accumulatedBorrow.add(accruedBorrowV1);
      return {
        market: b.market,
        accumulatedSupplyV1,
        accumulatedSupplyV2,
        accumulatedSupply,
        accumulatedBorrowV1,
        accumulatedBorrowV2,
        accumulatedBorrow,
      };
    })
  );
};

export const sumRewards = (marketsRewards: MarketRewards[]) =>
  marketsRewards.reduce((acc, m) => acc.add(m.accumulatedBorrow.add(m.accumulatedSupply)), constants.Zero);

// last update and current timestamp must be in the same Version

/**
 * This method upgrades the market with the indexes at the given ts
 */
const accrueSupplyRewards = async (b: UserBalance, ts: BigNumber, provider: Provider) => {
  const supplyIndex = await computeSupplyIndex(b.market, ts, provider);
  const { p2pSupplyIndex, poolSupplyIndex } = await computeSupplyIndexes(b.market, ts, provider);
  const accruedSupplyV1 = getUserAccumulatedRewards(supplyIndex, b.userSupplyIndex, b.underlyingSupplyBalance);
  const accruedSupplyV2 = getUserAccumulatedRewards(p2pSupplyIndex, b.userSupplyInP2PIndex, b.scaledSupplyInP2P).add(
    getUserAccumulatedRewards(poolSupplyIndex, b.userSupplyOnPoolIndex, b.scaledSupplyOnPool)
  );
  // update the market
  const updatedBalance = cloneDeep(b);
  updatedBalance.market.p2pSupplyIndex = p2pSupplyIndex;
  updatedBalance.market.poolSupplyIndex = poolSupplyIndex;
  updatedBalance.market.supplyIndex = supplyIndex;
  updatedBalance.market.supplyUpdateBlockTimestamp = ts;
  updatedBalance.market.supplyUpdateBlockTimestampV1 = ts;
  updatedBalance.userSupplyOnPoolIndex = poolSupplyIndex;
  updatedBalance.userSupplyInP2PIndex = p2pSupplyIndex;
  updatedBalance.userSupplyIndex = supplyIndex;
  return { updatedBalance, accruedSupplyV1, accruedSupplyV2 };
};

/**
 * This method upgrades the market with the indexes at the given ts
 */
const accrueBorrowRewards = async (b: UserBalance, ts: BigNumber, provider: Provider) => {
  const borrowIndex = await computeBorrowIndex(b.market, ts, provider);
  const { p2pBorrowIndex, poolBorrowIndex } = await computeBorrowIndexes(b.market, ts, provider);
  const accruedBorrowV1 = getUserAccumulatedRewards(borrowIndex, b.userBorrowIndex, b.underlyingBorrowBalance);
  const accruedBorrowV2 = getUserAccumulatedRewards(p2pBorrowIndex, b.userBorrowInP2PIndex, b.scaledBorrowInP2P).add(
    getUserAccumulatedRewards(poolBorrowIndex, b.userBorrowOnPoolIndex, b.scaledBorrowOnPool)
  );
  // update the market
  const updatedBalance = cloneDeep(b);
  updatedBalance.market.p2pBorrowIndex = p2pBorrowIndex;
  updatedBalance.market.poolBorrowIndex = poolBorrowIndex;
  updatedBalance.market.borrowIndex = borrowIndex;
  updatedBalance.market.borrowUpdateBlockTimestamp = ts;
  updatedBalance.market.borrowUpdateBlockTimestampV1 = ts;
  updatedBalance.userBorrowOnPoolIndex = poolBorrowIndex;
  updatedBalance.userBorrowInP2PIndex = p2pBorrowIndex;
  updatedBalance.userBorrowIndex = borrowIndex;
  return { updatedBalance, accruedBorrowV1, accruedBorrowV2 };
};

const getUserAccumulatedRewards = (marketIndex: BigNumber, userIndex: BigNumber, userBalance: BigNumber) => {
  if (userIndex.gt(marketIndex)) return BigNumber.from(0);
  return marketIndex.sub(userIndex).mul(userBalance).div(WAD); // with 18 decimals
};
const computeSupplyIndex = async (market: Market, currentTimestamp: BigNumberish, provider: providers.Provider) =>
  computeIndex(
    market.address,
    market.supplyIndex,
    market.supplyUpdateBlockTimestampV1,
    currentTimestamp,
    "supplyRate",
    market.lastTotalSupply,
    provider
  );

const computeSupplyIndexes = async (market: Market, currentTimestamp: BigNumberish, provider: providers.Provider) => {
  const rateType = "supplyRate";
  const marketAddress = market.address;

  // even if the index is in RAY for Morpho-Aave markets, this is not a big deal since we are using the proportion
  // between p2p and pool volumes
  const totalSupplyP2P = WadRayMath.wadMul(market.scaledSupplyInP2P, market.lastP2PSupplyIndex);
  const totalSupplyOnPool = WadRayMath.wadMul(market.scaledSupplyOnPool, market.lastPoolSupplyIndex);
  const totalSupply = totalSupplyOnPool.add(totalSupplyP2P);
  const lastPercentSpeed = totalSupply.isZero()
    ? constants.Zero
    : totalSupplyP2P.mul(PercentMath.BASE_PERCENT).div(totalSupply);
  return {
    p2pSupplyIndex: await computeIndex(
      marketAddress,
      market.p2pSupplyIndex,
      market.supplyUpdateBlockTimestamp,
      currentTimestamp,
      rateType,
      market.scaledSupplyInP2P,
      provider,
      (emission) => PercentMath.percentMul(emission, lastPercentSpeed)
    ),
    poolSupplyIndex: await computeIndex(
      marketAddress,
      market.poolSupplyIndex,
      market.supplyUpdateBlockTimestamp,
      currentTimestamp,
      rateType,
      market.scaledSupplyOnPool,
      provider,
      (emission) => PercentMath.percentMul(emission, PercentMath.BASE_PERCENT.sub(lastPercentSpeed))
    ),
  };
};
const computeBorrowIndex = async (market: Market, currentTimestamp: BigNumberish, provider: providers.Provider) =>
  computeIndex(
    market.address,
    market.borrowIndex,
    market.borrowUpdateBlockTimestampV1,
    currentTimestamp,
    "borrowRate",
    market.lastTotalBorrow,
    provider
  );

const computeBorrowIndexes = async (market: Market, currentTimestamp: BigNumberish, provider: providers.Provider) => {
  const rateType = "borrowRate";
  const marketAddress = market.address;

  const totalBorrowP2P = WadRayMath.wadMul(market.scaledBorrowInP2P, market.lastP2PBorrowIndex);
  const totalBorrowOnPool = WadRayMath.wadMul(market.scaledBorrowOnPool, market.lastPoolBorrowIndex);
  const totalBorrow = totalBorrowOnPool.add(totalBorrowP2P);
  const lastPercentSpeed = totalBorrow.isZero()
    ? constants.Zero
    : totalBorrowP2P.mul(PercentMath.BASE_PERCENT).div(totalBorrow);
  return {
    p2pBorrowIndex: await computeIndex(
      marketAddress,
      market.p2pBorrowIndex,
      market.borrowUpdateBlockTimestamp,
      currentTimestamp,
      rateType,
      market.scaledBorrowInP2P,
      provider,
      (emission) => PercentMath.percentMul(emission, lastPercentSpeed)
    ),
    poolBorrowIndex: await computeIndex(
      marketAddress,
      market.poolBorrowIndex,
      market.borrowUpdateBlockTimestamp,
      currentTimestamp,
      rateType,
      market.scaledBorrowOnPool,
      provider,
      (emission) => PercentMath.percentMul(emission, PercentMath.BASE_PERCENT.sub(lastPercentSpeed))
    ),
  };
};
const computeIndex = async (
  marketAddress: string,
  lastIndex: BigNumber,
  lastUpdateTimestamp: BigNumberish,
  currentTimestamp: BigNumberish,
  rateType: "borrowRate" | "supplyRate",
  totalUnderlying: BigNumber,
  provider: providers.Provider,
  speed: (emission: BigNumber) => BigNumber = (e) => e
) => {
  const epochs = getEpochsBetweenTimestamps(lastUpdateTimestamp, currentTimestamp) ?? [];
  // we first compute distribution of each epoch
  const distributions = Object.fromEntries(
    await Promise.all(
      epochs.map(async (epoch) => [epoch.epoch.id, await getEpochMarketsDistribution(epoch.epoch.id, provider)])
    )
  );
  return epochs.reduce((currentIndex, epoch) => {
    const initialTimestamp = maxBN(epoch.epoch.initialTimestamp, BigNumber.from(lastUpdateTimestamp));
    const finalTimestamp = minBN(epoch.epoch.finalTimestamp, BigNumber.from(currentTimestamp));
    const deltaTimestamp = finalTimestamp.sub(initialTimestamp);
    const marketsEmission = distributions[epoch.epoch.id];
    const emission = BigNumber.from(marketsEmission.markets[marketAddress]?.[rateType] ?? 0);
    const morphoAccrued = deltaTimestamp.mul(speed(emission)); // in WEI units;
    const ratio = totalUnderlying.eq(0) ? BigNumber.from(0) : morphoAccrued.mul(WAD).div(totalUnderlying); // in 18*2 - decimals units;
    return currentIndex.add(ratio);
  }, lastIndex);
};
