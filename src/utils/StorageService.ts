import * as path from "path";
import * as fs from "fs";
import { MarketsEmissionFs } from "../ages/distributions/MarketsEmissionFs";
import { Proof, Proofs } from "../ages/distributions/Proofs";
import { numberOfEpochs } from "../ages/ages";
import { UsersDistribution } from "../ages/distributions/UsersDistribution";
import { epochNumberToAgeEpochString } from "../helpers";

export interface StorageService {
  readMarketDistribution: (epochNumber: number) => Promise<MarketsEmissionFs | void>;
  writeMarketEmission: (epochNumber: number, emission: MarketsEmissionFs, force?: boolean) => Promise<void>;
  readUsersDistribution: (epochNumber: number) => Promise<UsersDistribution | void>;
  writeUsersDistribution: (epochNumber: number, distribution: UsersDistribution, force?: boolean) => Promise<void>;
  readProofs: (epochNumber: number) => Promise<Proofs | void>;
  readAllProofs: () => Promise<Proofs[]>;
  readUserProof: (epochNumber: number, address: string) => Promise<Proof | void>;
  writeProofs: (epochNumber: number, proofs: Proofs, force?: boolean) => Promise<void>;
}

export type ProofsCache = { [epoch: number]: Proofs | undefined };
export type MarketsEmissionCache = {
  [age: string]: {
    [epoch: string]: MarketsEmissionFs | undefined;
  };
};
export type UsersDistributionCache = {
  [age: string]: {
    [epoch: string]: UsersDistribution | undefined;
  };
};

export class FileSystemStorageService implements StorageService {
  #emissionsCache: MarketsEmissionCache = {};
  #distributionsCache: UsersDistributionCache = {};
  #proofsCache: ProofsCache = {};
  #distributionRoot = "../../distribution";

  async readMarketDistribution(epochNumber: number) {
    try {
      const { age, epoch } = this.#getAgeEpochPaths(epochNumber);

      const inCache = this.#emissionsCache[age]?.[epoch];
      if (inCache) return inCache;
      const { file } = this.#generateDistributionPath(age, epoch);
      const distribution = require(file) as MarketsEmissionFs;
      this.#emissionsCache[age] = { ...this.#emissionsCache[age], [epoch]: distribution };
      return distribution;
    } catch (error) {
      return;
    }
  }

  async writeMarketEmission(epochNumber: number, emission: MarketsEmissionFs, force?: boolean) {
    const { age, epoch } = this.#getAgeEpochPaths(epochNumber);

    const { folder, file } = this.#generateDistributionPath(age, epoch);
    const fileExists = await fs.promises
      .access(file, fs.constants.R_OK | fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);
    if (fileExists && !force) throw new Error(`File ${file} already exists, can't write it.`);
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(emission, null, 2));
  }

  async readUsersDistribution(epochNumber: number) {
    try {
      const { age, epoch } = this.#getAgeEpochPaths(epochNumber);

      const inCache = this.#distributionsCache[age]?.[epoch];
      if (inCache) return inCache;
      const { file } = this.#generateUsersDistributionPath(age, epoch);
      const distribution = require(file) as UsersDistribution;
      this.#distributionsCache[age] = { ...this.#distributionsCache[age], [epoch]: distribution };
      return distribution;
    } catch (error) {
      return;
    }
  }

  async writeUsersDistribution(epochNumber: number, distribution: UsersDistribution, force?: boolean) {
    const { age, epoch } = this.#getAgeEpochPaths(epochNumber);
    const { folder, file } = this.#generateUsersDistributionPath(age, epoch);

    const fileExists = await fs.promises
      .access(file, fs.constants.R_OK | fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);
    if (fileExists && !force) throw new Error(`File ${file} already exists, can't write it.`);
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(distribution, null, 2));
  }

  async readProofs(epoch: number) {
    try {
      const inCache = this.#proofsCache[epoch];
      if (inCache) return inCache;
      const { file } = this.#generateProofsPath(epoch);
      const proofs = require(file) as Proofs;
      this.#proofsCache[epoch] = proofs;
      return proofs;
    } catch (error) {
      return;
    }
  }

  async readAllProofs() {
    const result = await Promise.all(
      new Array(numberOfEpochs).fill(0).map(async (_, index) => {
        const epoch = numberOfEpochs - index;
        const proofs = await this.readProofs(epoch);
        return proofs ? [proofs] : [];
      })
    );
    return result.flat();
  }

  async readUserProof(epoch: number, address: string) {
    const proof = await this.readProofs(epoch);
    return proof?.proofs?.[address];
  }

  async writeProofs(epoch: number, proofs: Proofs, force?: boolean) {
    const { folder, file } = this.#generateProofsPath(epoch);
    const fileExists = await fs.promises
      .access(file, fs.constants.R_OK | fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);
    if (fileExists && !force) throw new Error(`File ${file} already exists, can't write it.`);
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(proofs, null, 2));
  }

  #generateDistributionPath(age: string, epoch: string) {
    const folder = path.resolve(__dirname, this.#distributionRoot, age, epoch);
    const file = path.resolve(folder, "marketsEmission.json");
    return { folder, file };
  }

  #generateProofsPath(epoch: number) {
    const folder = path.resolve(__dirname, this.#distributionRoot, "proofs");
    const filename = `proofs-${epoch}.json`;
    const file = path.resolve(folder, filename);
    return { folder, file };
  }

  #generateUsersDistributionPath(age: string, epoch: string) {
    const folder = path.resolve(__dirname, this.#distributionRoot, age, epoch);
    const file = path.resolve(folder, "usersDistribution.json");
    return { folder, file };
  }

  #getAgeEpochPaths(epochId: number) {
    return epochNumberToAgeEpochString(epochId);
  }
}