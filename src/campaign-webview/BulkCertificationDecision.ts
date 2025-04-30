import * as vscode from 'vscode';
import { CertificationsApiMakeIdentityDecisionRequest, IdentityCertificationDto, AccessReviewItem, ReviewDecision } from "sailpoint-api-client";
import { ISCClient } from "../services/ISCClient";

const BATCH_SIZE = 40;

export interface DecisionReport {
    success: number;
    error: number;
    errorMessages: string[];
}

export type DecisionType = ReviewDecision;

interface DecisionRequest {
    id: string;
    decision: DecisionType;
    comment: string;
}

export class BulkCertificationDecision {
    constructor(private readonly client: ISCClient) {}

    async processBulkDecision(
        certifications: IdentityCertificationDto[],
        decision: DecisionType,
        comment: string
    ): Promise<DecisionReport> {
        const report: DecisionReport = {
            success: 0,
            error: 0,
            errorMessages: []
        };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Processing ${decision} decisions`,
            cancellable: false
        }, async (progress) => {
            const totalCertifications = certifications.length;
            let processedCertifications = 0;

            for (const certification of certifications) {
                try {
                    // Get all review items for this certification
                    const reviewItems = await this.client.getCertificationReviewItems(certification.id, false);
                    const totalBatches = Math.ceil(reviewItems.length / BATCH_SIZE);
                    let processedBatches = 0;
                    
                    // Process review items in batches
                    for (let i = 0; i < reviewItems.length; i += BATCH_SIZE) {
                        const batch = reviewItems.slice(i, i + BATCH_SIZE);
                        
                        try {
                            await this.processBatch(certification.id, batch, decision, comment);
                            report.success += batch.length;
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            report.error += batch.length;
                            report.errorMessages.push(
                                `Error processing batch for certification ${certification.id}: ${errorMessage}`
                            );
                        }

                        processedBatches++;
                        progress.report({
                            message: `Processing certification ${processedCertifications + 1}/${totalCertifications} - Batch ${processedBatches}/${totalBatches}`,
                            increment: (100 / totalCertifications) / totalBatches
                        });
                    }

                    processedCertifications++;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    report.errorMessages.push(
                        `Error fetching review items for certification ${certification.id}: ${errorMessage}`
                    );
                }
            }
        });

        return report;
    }

    private async processBatch(
        certificationId: string,
        reviewItems: AccessReviewItem[],
        decision: DecisionType,
        comment: string
    ): Promise<void> {
        const request: CertificationsApiMakeIdentityDecisionRequest = {
            id: certificationId,
            reviewDecision: [decision]
        };

        await this.client.certificationDecision(request);
    }
} 