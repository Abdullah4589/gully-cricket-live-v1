import * as Network from "expo-network";

import { listLocalIds, sqliteSyncRepository } from "../db/database";
import { queryClient } from "../query";
import { apiBase } from "./api";
import { flushMatchQueue } from "./flush";

export async function kickFlush(force: boolean): Promise<void> {
  if (!force) {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) {
      return;
    }
  }
  const repo = sqliteSyncRepository();
  const ids = await listLocalIds();
  for (const localId of ids) {
    await flushMatchQueue(repo, localId, { baseUrl: apiBase() });
  }
  await queryClient.invalidateQueries({ queryKey: ["sync-status"] });
  await queryClient.invalidateQueries({ queryKey: ["matches"] });
}
