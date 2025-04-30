<script lang="ts">
  import * as vscode from 'svelte';
  import { onMount } from "svelte";
  //@ts-ignore
  import ProgressIndicator from "./lib/ProgressIndicator.svelte";
  //@ts-ignore
  import SearchCampaignPieCharts from "./lib/SearchCampaignPieCharts.svelte";
  //@ts-ignore
  import SourceOwnerPieCharts from "./lib/SourceOwnerPieCharts.svelte";
  //@ts-ignore
  import DataTable from "./lib/datatable/DataTable.svelte";
  //@ts-ignore
  import Refresh from "./lib/datatable/svgs/refresh.svelte";
  import type {
    Action,
    Column,
    FetchDataCallback,
    FetchOptions,
    MultiSelectAction,
  } from "./lib/datatable/Model";
  import { ClientFactory } from "./services/ClientFactory";
  import type { KPIs, Reviewer } from "./services/Client";
  import type { ReviewDecision } from 'sailpoint-api-client/dist/v3';
  import * as commands from "./services/Commands";
  import type { IdentityCertificationDto } from "./types";

  const ReviewDecisions = {
    APPROVE: ('APPROVE' as unknown) as ReviewDecision,
    REVOKE: ('REVOKE' as unknown) as ReviewDecision
  } as const;

  let promiseResult = $state<Promise<KPIs>>();
  let promiseStatus = $state<Promise<string>>();
  let client = ClientFactory.getClient();
  let selectedDecision: ReviewDecision = $state<ReviewDecision>(ReviewDecisions.APPROVE);
  let comment = $state('');

  const actions: Action<Reviewer>[] = [];
  const multiSelectActions: MultiSelectAction<Reviewer>[] = [];
  let reviewersTable: DataTable;
  const onlyActive = (row: Reviewer) =>
    row.phase !== "SIGNED" || (row.identitiesRemaining !== undefined && row.identitiesRemaining > 0);
  if (window.data.campaignStatus !== "COMPLETED") {
    multiSelectActions.push(
      {
        label: "Bulk Action",
        callback: async (rows: Reviewer[]) => {
          selectedCertifications = rows.map(reviewer => ({
            id: reviewer.id,
            name: reviewer.name,
            completed: reviewer.phase === "SIGNED",
            campaign: {
              id: window.data.campaignId,
              name: window.data.campaignName
            }
          } as IdentityCertificationDto));
          handleBulkDecision();
        },
      },
      {
        label: "Escalate",
        callback: async (rows: Reviewer[]) => {
          await client.escalateReviewers(rows);
          reviewersTable?.updateData();
        },
      },
      {
        label: "Send Reminder",
        callback: async (rows: Reviewer[]) => {
          await client.sendReminders(rows);
        },
      }
    );

    actions.push(
      {
        label: "Bulk Action",
        callback: async (row: Reviewer) => {
          selectedCertifications = [{
            id: row.id,
            name: row.name,
            completed: row.phase === "SIGNED",
            campaign: {
              id: window.data.campaignId,
              name: window.data.campaignName
            }
          } as IdentityCertificationDto];
          handleBulkDecision();
        },
        condition: onlyActive,
      },
      {
        label: "Escalate",
        callback: async (row: Reviewer) => {
          await client.escalateReviewers([row]);
          reviewersTable?.updateData();
        },
        condition: onlyActive,
      },
      {
        label: "Send Reminder",
        callback: async (row: Reviewer) => {
          await client.sendReminders([row]);
        },
        condition: onlyActive,
      }
    );
  }

  function updateKPIsAndStatus(force: boolean = true) {
    promiseResult = client.getKPIs(force);
    promiseStatus = client.getStatus(window.data.campaignId, force);
  }

  onMount(async () => {
    updateKPIsAndStatus(false);
  });

  let reviewerColumns: Column[] = $state([
    {
      field: "name",
      label: "Name",
      sortable: true,
    },
    {
      field: "phase",
      label: "Phase",
    },
    {
      field: "email",
      label: "Email",
    },
    {
      field: "identitiesRemaining",
      label: "Identities Remaining",
    },
    {
      field: "identitiesTotal",
      label: "Total Identities",
      visible: false,
    },
    {
      field: "identitiesCompleted",
      label: "Completed Identities",
      visible: false,
    },
    {
      field: "decisionsTotal",
      label: "Total Decision",
      visible: false,
    },
    {
      field: "decisionsMade",
      label: "Decisions Made",
      visible: false,
    },
    {
      field: "decisionsRemaining",
      label: "Decisions Remaining",
      visible: false,
    },
    {
      field: "reassignmentName",
      label: "Reassigned From",
      visible: false,
    },
    {
      field: "reassignmentComment",
      label: "Reassignment Comment",
      visible: false,
    },
    {
      field: "reassignmentEmail",
      label: "Reassigned From (Email)",
      visible: false,
    },
  ]);

  const fetchData: FetchDataCallback = async (fetchOptions: FetchOptions) => {
    return client.getReviewers(fetchOptions, fetchOptions.force ?? false);
  };

  let selectedCertifications: IdentityCertificationDto[] = $state([]);
  let showBulkDecisionModal = $state(false);
  let isProcessing = $state(false);

  function handleBulkDecision() {
    if (selectedCertifications.length === 0) {
      window.vscode.postMessage({
        command: 'showWarning',
        payload: 'Please select at least one certification to perform bulk action.'
      });
      return;
    }
    
    showBulkDecisionModal = true;
  }

  function handleBulkDecisionSubmit() {
    if (!comment) return;
    
    isProcessing = true;
    try {
      window.vscode.postMessage({
        command: commands.BULK_DECISION,
        requestId: Math.random().toString(36).substring(2, 15),
        payload: {
          certifications: selectedCertifications,
          decision: selectedDecision,
          comment
        }
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      window.vscode.postMessage({
        command: 'showError',
        payload: `Error processing bulk decision: ${errorMessage}`
      });
    } finally {
      isProcessing = false;
      showBulkDecisionModal = false;
      selectedCertifications = [];
      comment = '';
      selectedDecision = ReviewDecisions.APPROVE;
    }
  }

  function closeBulkDecisionModal() {
    showBulkDecisionModal = false;
    comment = '';
    selectedDecision = ReviewDecisions.APPROVE;
  }

  function handleSelectionChange(event: CustomEvent) {
    selectedCertifications = event.detail.selected;
  }

  interface Campaign {
    id: string;
    name: string;
    label?: string;
    [key: string]: any;
  }

  let allSelected = false;
  let someSelected = false;
  let selectedCampaigns: Campaign[] = [];
  let filteredCampaigns: Campaign[] = [];
  let fields: Array<{ label: string, key: string }> = [];

  function handleSelectAll(): void {
    if (allSelected) {
      selectedCampaigns = [];
    } else {
      selectedCampaigns = [...filteredCampaigns];
    }
    allSelected = !allSelected;
    someSelected = false;
  }

  function handleSelect(campaign: Campaign): void {
    const index = selectedCampaigns.indexOf(campaign);
    if (index === -1) {
      selectedCampaigns = [...selectedCampaigns, campaign];
    } else {
      selectedCampaigns = selectedCampaigns.filter(c => c !== campaign);
    }
    
    allSelected = selectedCampaigns.length === filteredCampaigns.length;
    someSelected = selectedCampaigns.length > 0 && !allSelected;
  }
</script>

<main>
  <section id="headerSection">
    <div>
      <h1>{window.data.campaignName}</h1>
      {#await promiseStatus then value}
        <h2><span class="badge"> {value}</span></h2>
      {/await}
    </div>
    <div class="headerSection--buttons">
      <button class="btn" onclick={() => updateKPIsAndStatus()}
        ><span>
          <Refresh />
        </span>
      </button>
    </div>
  </section>
  {#await promiseResult}
    <div class="loading"></div>
  {:then data}
    <section id="kpi">
      <div class="item">
        <ProgressIndicator
          name="Access Review Completed"
          current={data!.totals.totalAccessReviewsCompleted}
          total={data!.totals.totalAccessReviews}
        />
      </div>
      <div class="item">
        <ProgressIndicator
          name="Identities Completed"
          current={data!.totals.totalIdentitiesCompleted}
          total={data!.totals.totalIdentities}
        />
      </div>
      <div class="item">
        <ProgressIndicator
          name="Items Completed"
          current={data!.totals.totalAccessItemsCompleted}
          total={data!.totals.totalAccessItems}
        />
      </div>
    </section>
    <section id="accessitems">
      {#if window.data.campaignType == "SOURCE_OWNER" || window.data.campaignType == "MACHINE_ACCOUNT"}
        <SourceOwnerPieCharts data={data!.totalAccessItems} />
      {:else}
        <SearchCampaignPieCharts data={data!.totalAccessItems} />
      {/if}
    </section>
  {/await}
  <section id="reviewers">
    <div class="section-header">
      <h2>Campaign Reviewers</h2>
      <div class="headerSection--buttons">
        <button class="btn" onclick={() => updateKPIsAndStatus()}>
          <span><Refresh /></span>
        </button>
      </div>
    </div>
    <DataTable
      bind:this={reviewersTable}
      bind:columns={reviewerColumns}
      bind:selectedRows={selectedCertifications}
      {fetchData}
      {actions}
      {multiSelectActions}
    />
  </section>

  <!-- Bulk Decision Modal -->
  <div class="modal" class:show={showBulkDecisionModal}>
    <div class="modal-content">
      <h2>Bulk Decision</h2>
      
      <div class="form-group">
        <label>
          <input
            type="radio"
            name="decision"
            value="APPROVE"
            bind:group={selectedDecision}
          />
          Approve
        </label>
        
        <label>
          <input
            type="radio"
            name="decision"
            value="REVOKE"
            bind:group={selectedDecision}
          />
          Revoke
        </label>
      </div>
      
      <div class="form-group">
        <label for="comment">Comment:</label>
        <textarea
          id="comment"
          bind:value={comment}
          placeholder="Enter your comment..."
          required
        ></textarea>
      </div>
      
      <div class="button-group">
        <button class="btn btn-secondary" onclick={closeBulkDecisionModal}>Cancel</button>
        <button 
          class="btn btn-primary" 
          onclick={handleBulkDecisionSubmit}
          disabled={!comment}
        >
          Submit
        </button>
      </div>
    </div>
  </div>
</main>

<style>
  :global(.campaign-table) {
    background-color: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
  }
  :global(.campaign-table th),
  :global(.campaign-table td) {
    color: var(--vscode-editor-foreground);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  :global(.campaign-table tr:hover) {
    background-color: var(--vscode-list-hoverBackground);
  }
  :global(.campaign-table .mdc-data-table__header-cell) {
    color: var(--vscode-editor-foreground);
    font-weight: bold;
  }

  .headerSection--buttons {
    display: flex;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.5rem 1rem;
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  h1, h2 {
    color: var(--vscode-editor-foreground);
    margin: 0;
  }

  .badge {
    background-color: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .loading {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
  }

  .modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
  }
  
  .modal.show {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .modal-content {
    background-color: var(--vscode-editor-background);
    padding: 2rem;
    border-radius: 4px;
    min-width: 400px;
  }
  
  .form-group {
    margin-bottom: 1rem;
  }
  
  label {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--vscode-editor-foreground);
  }
  
  textarea {
    width: 100%;
    min-height: 100px;
    padding: 0.5rem;
    margin-bottom: 1rem;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
  }
  
  .button-group {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }
  
  .btn-primary {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .btn-secondary {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
</style>
