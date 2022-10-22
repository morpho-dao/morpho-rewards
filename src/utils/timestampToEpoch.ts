import { BigNumberish } from "ethers";
import { AgeConfig, allEpochs, EpochConfig } from "../ages";
import { ages } from "../ages";
import { Optional } from "../helpers/types";

export const timestampToEpoch = (timestamp: BigNumberish) => {
  const epoch = allEpochs.find((epoch) => epoch.initialTimestamp.lte(timestamp) && epoch.finalTimestamp.gt(timestamp));
  if (!epoch) return;
  const age = ages[epoch.ageId];
  return {
    age: age as AgeConfig,
    epoch: age.epochs[epoch.epochId] as EpochConfig,
  };
};

export const getEpochsBetweenTimestamps = (tFrom: BigNumberish, tTo: BigNumberish) => {
  let epochFrom = timestampToEpoch(tFrom);
  const epochTo = timestampToEpoch(tTo);
  if (!epochTo) return [];
  if (!epochFrom) {
    // if there is only the first epoch
    if (epochTo.epoch.id === "age1-epoch1") return [epochTo];
    // else we start from the first epoch
    epochFrom = { age: ages[0], epoch: allEpochs[0] };
  }
  const epochs = [epochFrom];
  if (!epochTo) return epochs;

  let newEpoch: Optional<{
    age: AgeConfig;
    epoch: EpochConfig;
  }> = epochFrom;
  while (newEpoch?.epoch?.epochName && newEpoch.epoch.id !== epochTo.epoch.id) {
    newEpoch = getNextEpoch(newEpoch.age.ageName, newEpoch?.epoch?.epochName);

    if (newEpoch && newEpoch?.epoch?.initialTimestamp.gt(tTo)) epochs.push(newEpoch);
    else break;
  }
  return epochs;
};

export const getNextEpoch = (age?: string, epoch?: string) => {
  if (!age || !epoch) return;
  const currentEpoch = allEpochs.find((_epoch) => _epoch.id === `${age}-${epoch}`);
  if (!currentEpoch) throw Error(`Unknown epoch: ${age}-${epoch}`);
  const currentEpochId = allEpochs.indexOf(currentEpoch);
  if (currentEpochId === allEpochs.length - 1) return;
  const nextEpoch = allEpochs[currentEpochId + 1];
  return {
    age: ages[nextEpoch.ageId] as AgeConfig,
    epoch: ages[nextEpoch.ageId].epochs[nextEpoch.epochId] as EpochConfig,
  };
};

export const getPrevEpoch = (epochId?: string) => {
  if (!epochId) return;
  const currentEpochIndex = allEpochs.findIndex((_epoch) => _epoch.id === epochId);
  if (currentEpochIndex === -1) throw Error(`Unknown epoch: ${epochId}`);
  if (currentEpochIndex === 0) return; // This is the first epoch;
  const prevEpoch = allEpochs[currentEpochIndex - 1];
  return {
    age: ages[prevEpoch.ageId] as AgeConfig,
    epoch: ages[prevEpoch.ageId].epochs[prevEpoch.epochId] as EpochConfig,
  };
};
