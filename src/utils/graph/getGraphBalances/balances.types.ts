import { BigNumber } from "ethers";
import { Market } from "../getGraphMarkets/markets.types";

export interface GraphUserBalances {
  id: string;
  address: string;
  balances: {
    timestamp: string;
    underlyingSupplyBalance: string;
    underlyingBorrowBalance: string;
    userSupplyIndex: string;
    userBorrowIndex: string;
    unclaimedMorpho: string;
    market: {
      address: string;
      supplyIndex: string;
      borrowIndex: string;
      supplyUpdateBlockTimestamp: string;
      borrowUpdateBlockTimestamp: string;
      lastP2PBorrowIndex: string;
      lastPoolBorrowIndex: string;
      lastP2PSupplyIndex: string;
      lastPoolSupplyIndex: string;
      lastTotalBorrow: string;
      lastTotalSupply: string;
    };
  }[];
}
export interface UserBalances {
  address: string;
  id: string;
  balances: UserBalance[];
}
export interface UserBalance {
  underlyingSupplyBalance: BigNumber;
  underlyingBorrowBalance: BigNumber;
  userSupplyIndex: BigNumber;
  userBorrowIndex: BigNumber;
  accumulatedMorpho: BigNumber;
  market: Market;
}
