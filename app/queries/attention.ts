// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import type { AttentionSummary } from "~/types";
import { queryKeys } from "./keys";

export function useAttentionSummary() {
	return useQuery<AttentionSummary>({
		queryKey: queryKeys.attention,
		queryFn: () => api.getAttentionSummary(),
		staleTime: 15_000,
	});
}
