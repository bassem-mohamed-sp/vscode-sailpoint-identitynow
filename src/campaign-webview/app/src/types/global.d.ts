interface VSCodeApi {
    postMessage(message: any): void;
}

interface CampaignData {
    campaignId: string;
    campaignName: string;
    campaignStatus: string;
    campaignType: "SOURCE_OWNER" | "MACHINE_ACCOUNT" | string;
}

declare global {
    interface Window {
        vscode: VSCodeApi;
        data: CampaignData;
    }
}

export {}; 