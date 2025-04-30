declare module '@smui/data-table' {
  import type { SvelteComponent } from 'svelte';
  
  interface DataTableProps {
    columns?: any[];
    fetchData?: (options: any) => Promise<any>;
    actions?: any[];
    multiSelectActions?: any[];
  }

  export default class DataTable extends SvelteComponent<DataTableProps> {}
} 