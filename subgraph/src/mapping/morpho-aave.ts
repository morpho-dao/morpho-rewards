import {
  Borrowed,
  Supplied,
  P2PIndexesUpdated,
  Withdrawn,
  Repaid,
  BorrowerPositionUpdated,
  SupplierPositionUpdated,
} from "../../generated/MorphoAave/MorphoAave";
import { getOrInitMarket } from "../initializer";
import {
  handleBorrowedInternal,
  handleBorrowerPositionUpdatedInternal,
  handleRepaidInternal,
  handleSuppliedInternal,
  handleSupplierPositionUpdatedInternal,
  handleWithdrawnInternal,
} from "../mapping-internal";
const RAY_UNITS = 27;
export function handleBorrowed(event: Borrowed): void {
  const marketAddress = event.params._poolToken;
  const userAddress = event.params._borrower;
  handleBorrowedInternal(
    event,
    marketAddress,
    userAddress,
    event.params._balanceOnPool,
    event.params._balanceInP2P,
    RAY_UNITS
  );
}

export function handleSupplied(event: Supplied): void {
  const marketAddress = event.params._poolToken;
  const userAddress = event.params._onBehalf;
  handleSuppliedInternal(
    event,
    marketAddress,
    userAddress,
    event.params._balanceOnPool,
    event.params._balanceInP2P,
    RAY_UNITS
  );
}

export function handleP2PIndexesUpdated(event: P2PIndexesUpdated): void {
  const market = getOrInitMarket(event.params._poolToken, event.block.timestamp);

  market.lastP2PBorrowIndex = event.params._p2pBorrowIndex;
  market.lastP2PSupplyIndex = event.params._p2pSupplyIndex;
  market.lastPoolBorrowIndex = event.params._poolBorrowIndex;
  market.lastPoolSupplyIndex = event.params._poolSupplyIndex;
  market.save();
}

export function handleWithdrawn(event: Withdrawn): void {
  const marketAddress = event.params._poolToken;
  const userAddress = event.params._supplier;
  handleWithdrawnInternal(
    event,
    marketAddress,
    userAddress,
    event.params._balanceOnPool,
    event.params._balanceInP2P,
    RAY_UNITS
  );
}

export function handleRepaid(event: Repaid): void {
  const marketAddress = event.params._poolToken;
  const userAddress = event.params._onBehalf;
  handleRepaidInternal(
    event,
    marketAddress,
    userAddress,
    event.params._balanceOnPool,
    event.params._balanceInP2P,
    RAY_UNITS
  );
}

export function handleBorrowerPositionUpdated(event: BorrowerPositionUpdated): void {
  handleBorrowerPositionUpdatedInternal(
    event,
    event.params._poolToken,
    event.params._user,
    event.params._balanceOnPool,
    event.params._balanceInP2P,
    RAY_UNITS
  );
}
export function handleSupplierPositionUpdated(event: SupplierPositionUpdated): void {
  handleSupplierPositionUpdatedInternal(
    event,
    event.params._poolToken,
    event.params._user,
    event.params._balanceOnPool,
    event.params._balanceInP2P,
    RAY_UNITS
  );
}
