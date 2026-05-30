// SPDX-License-Identifier: Apache-2.0

export type ContinuitySummaryStatus = 'draft' | 'approved';
export type ContinuitySummaryTrigger = 'threshold' | 'stop' | 'manual';

export interface ContinuitySummary {
  id: number;
  contentSessionId: string;
  project: string;
  status: ContinuitySummaryStatus;
  trigger: ContinuitySummaryTrigger;
  stateSection: string | null;
  arcSection: string | null;
  nextSection: string | null;
  transcriptFill: number | null;
  generatedAtEpoch: number;
  approvedAtEpoch: number | null;
}

export interface StoreContinuitySummaryInput {
  contentSessionId: string;
  project: string;
  trigger: ContinuitySummaryTrigger;
  stateSection: string | null;
  arcSection: string | null;
  nextSection: string | null;
  transcriptFill?: number;
  status?: ContinuitySummaryStatus;
}
