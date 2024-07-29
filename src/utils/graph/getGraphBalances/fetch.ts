import { providers } from "ethers";

import balancesQuery from "./balances.query";
import { GraphUserBalances, UserBalances } from "./balances.types";
import { formatGraphBalances } from "./graphBalances.formatter";

export const fetchUsers = async (graphUrl: string, block?: providers.BlockTag) => {
  let hasMore = true;
  const batchSize = 1000;
  let usersBalances: UserBalances[] = [];

  let offset = "";

  while (hasMore) {
    const newBalances = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: block ? balancesQuery.balancesQueryWithBlockPaginated : balancesQuery.balancesQueryPaginated,
        variables: { size: batchSize, lastUser: offset, block },
      }),
    })
      .then((result) => {
        if (!result.ok) return Promise.reject(result);
        return result.json();
      })
      .then((result: { data: { users: GraphUserBalances[] } | { error: any } }) => {
        if (!("users" in result.data)) throw Error(result.data.toString());
        return result.data.users.map(formatGraphBalances);
      });

    hasMore = newBalances.length === batchSize;
    offset = newBalances.length > 0 ? newBalances[newBalances.length - 1].id : "";
    usersBalances = [...usersBalances, ...newBalances];
  }

  return usersBalances;
};
