/**
 * token-tracker.js
 * 
 * This module tracks token usage across different API calls to Claude.
 * It provides functions to record and report on token usage.
 */

import fs from 'fs/promises';
import path from 'path';
import config from '../config.js';

// In-memory storage for token usage
const usageData = {
  extraction: {}, // Company-level usage details for regular extraction
  batchExtraction: {}, // Company-level usage details for batch extraction
  totalInputTokens: 0,
  totalOutputTokens: 0,
  calls: 0,
  batchCalls: 0
};

/**
 * Record token usage from a Claude API extraction call
 * @param {string} companyId - Identifier for the company
 * @param {object} apiResponse - Response from Claude API containing usage info
 */
function recordClaudeExtractionUsage(companyId, apiResponse) {
  if (!companyId) {
    console.warn('Missing companyId while attempting to record token usage');
    return;
  }

  // Handle missing or invalid API response
  if (!apiResponse || !apiResponse.usage) {
    console.warn(`No usage data available for ${companyId}, using estimates instead`);
    
    // Estimate some reasonable numbers to at least have some tracking
    const estimatedInputTokens = 3000;  // Reasonable estimate for request size
    const estimatedOutputTokens = 2000; // Reasonable estimate for response size
    
    // Record estimated usage
    usageData.extraction[companyId] = {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      totalTokens: estimatedInputTokens + estimatedOutputTokens,
      timestamp: new Date().toISOString(),
      isEstimated: true
    };
    
    // Update global totals with estimates
    usageData.totalInputTokens += estimatedInputTokens;
    usageData.totalOutputTokens += estimatedOutputTokens;
    usageData.calls += 1;
    
    console.log(`Recorded estimated token usage for ${companyId}: ~${estimatedInputTokens} input + ~${estimatedOutputTokens} output tokens`);
    return;
  }
  
  const { input_tokens, output_tokens } = apiResponse.usage;
  
  // Record company-specific usage
  usageData.extraction[companyId] = {
    inputTokens: input_tokens,
    outputTokens: output_tokens,
    totalTokens: input_tokens + output_tokens,
    timestamp: new Date().toISOString()
  };
  
  // Update global totals
  usageData.totalInputTokens += input_tokens;
  usageData.totalOutputTokens += output_tokens;
  usageData.calls += 1;
  
  console.log(`Recorded token usage for ${companyId}: ${input_tokens} input + ${output_tokens} output tokens`);
}

/**
 * Record token usage from a Claude API batch extraction call
 * @param {string} companyId - Identifier for the company
 * @param {number} inputTokens - Number of input tokens used
 * @param {number} outputTokens - Number of output tokens used
 */
function recordClaudeBatchExtractionUsage(companyId, inputTokens, outputTokens) {
  if (!companyId) {
    console.warn('Missing companyId while attempting to record batch token usage');
    return;
  }

  // Handle missing token counts
  if (inputTokens === undefined || outputTokens === undefined) {
    console.warn(`Missing token counts for ${companyId}, using estimates instead`);
    
    // Estimate some reasonable numbers to at least have some tracking
    inputTokens = 3000;  // Reasonable estimate for batch request size
    outputTokens = 2000; // Reasonable estimate for batch response size
    
    console.log(`Using estimated batch token usage for ${companyId}: ~${inputTokens} input, ~${outputTokens} output tokens`);
  } else {
    console.log(`Recording batch token usage: ${companyId} with ${inputTokens} input, ${outputTokens} output tokens`);
  }
  
  // Record company-specific usage
  usageData.batchExtraction[companyId] = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    timestamp: new Date().toISOString(),
    isBatch: true,
    isEstimated: inputTokens === 3000 && outputTokens === 2000 // Flag if we used estimates
  };
  
  // Update global totals
  usageData.totalInputTokens += inputTokens;
  usageData.totalOutputTokens += outputTokens;
  usageData.batchCalls += 1;
  
  console.log(`Recorded batch token usage for ${companyId}: ${inputTokens} input + ${outputTokens} output tokens`);
}

/**
 * Generate a human-readable report of token usage
 * @returns {string} - Formatted usage report
 */
function generateUsageReport() {
  // Calculate cost estimates based on current Claude pricing
  // Regular API pricing - Claude 3.7 Sonnet pricing as of March 2025
  const regularInputCostPer1K = 5.00 / 1000000;  // $5 per 1M input tokens
  const regularOutputCostPer1K = 15.00 / 1000000; // $15 per 1M output tokens
  
  // Batch API pricing (typically around 50% of regular for high volume)
  const batchInputCostPer1K = 2.50 / 1000000;  // $2.50 per 1M input tokens 
  const batchOutputCostPer1K = 7.50 / 1000000; // $7.50 per 1M output tokens
  
  // Count tokens by type
  let regularInputTokens = 0;
  let regularOutputTokens = 0;
  let batchInputTokens = 0;
  let batchOutputTokens = 0;
  let estimatedRegularCount = 0;
  let estimatedBatchCount = 0;
  
  // Count regular extraction tokens
  Object.values(usageData.extraction).forEach(usage => {
    regularInputTokens += usage.inputTokens;
    regularOutputTokens += usage.outputTokens;
    if (usage.isEstimated) estimatedRegularCount++;
  });
  
  // Count batch extraction tokens
  Object.values(usageData.batchExtraction).forEach(usage => {
    batchInputTokens += usage.inputTokens;
    batchOutputTokens += usage.outputTokens;
    if (usage.isEstimated) estimatedBatchCount++;
  });
  
  // Calculate costs
  const regularInputCost = (regularInputTokens * regularInputCostPer1K).toFixed(4);
  const regularOutputCost = (regularOutputTokens * regularOutputCostPer1K).toFixed(4);
  const regularTotalCost = (parseFloat(regularInputCost) + parseFloat(regularOutputCost)).toFixed(4);
  
  const batchInputCost = (batchInputTokens * batchInputCostPer1K).toFixed(4);
  const batchOutputCost = (batchOutputTokens * batchOutputCostPer1K).toFixed(4);
  const batchTotalCost = (parseFloat(batchInputCost) + parseFloat(batchOutputCost)).toFixed(4);
  
  const totalCost = (parseFloat(regularTotalCost) + parseFloat(batchTotalCost)).toFixed(4);
  const estimationDisclaimer = (estimatedRegularCount > 0 || estimatedBatchCount > 0) ? 
    `⚠️ Note: ${estimatedRegularCount + estimatedBatchCount} calls used estimated token counts due to missing data.\n` : '';
  
  // Build the report
  let report = '\n=== Claude API Token Usage Report ===\n\n';
  
  // Add model and date information
  report += `Model: ${config.claudeModel}\n`;
  report += `Date: ${new Date().toISOString()}\n\n`;
  
  if (estimationDisclaimer) {
    report += estimationDisclaimer + '\n';
  }
  
  // Regular API usage
  report += 'Regular API Usage:\n';
  report += '-----------------\n';
  report += `Regular API Calls: ${usageData.calls}${estimatedRegularCount > 0 ? ` (${estimatedRegularCount} estimated)` : ''}\n`;
  report += `Regular Input Tokens: ${regularInputTokens.toLocaleString()}\n`;
  report += `Regular Output Tokens: ${regularOutputTokens.toLocaleString()}\n`;
  report += `Regular Total Tokens: ${(regularInputTokens + regularOutputTokens).toLocaleString()}\n`;
  report += `Regular API Cost: ${regularTotalCost}\n\n`;
  
  // Batch API usage
  report += 'Batch API Usage:\n';
  report += '----------------\n';
  report += `Batch API Calls: ${usageData.batchCalls}${estimatedBatchCount > 0 ? ` (${estimatedBatchCount} estimated)` : ''}\n`;
  report += `Batch Input Tokens: ${batchInputTokens.toLocaleString()}\n`;
  report += `Batch Output Tokens: ${batchOutputTokens.toLocaleString()}\n`;
  report += `Batch Total Tokens: ${(batchInputTokens + batchOutputTokens).toLocaleString()}\n`;
  report += `Batch API Cost: ${batchTotalCost}\n\n`;
  
  // Total usage
  report += 'Total API Usage:\n';
  report += '---------------\n';
  report += `Total API Calls: ${usageData.calls + usageData.batchCalls}\n`;
  report += `Total Input Tokens: ${usageData.totalInputTokens.toLocaleString()}\n`;
  report += `Total Output Tokens: ${usageData.totalOutputTokens.toLocaleString()}\n`;
  report += `Total Tokens: ${(usageData.totalInputTokens + usageData.totalOutputTokens).toLocaleString()}\n`;
  report += `Total API Cost: ${totalCost}\n\n`;
  
  // Pricing assumptions
  report += 'Pricing Assumptions:\n';
  report += '-------------------\n';
  report += `Regular API: ${regularInputCostPer1K * 1000000}/1M input tokens, ${regularOutputCostPer1K * 1000000}/1M output tokens\n`;
  report += `Batch API: ${batchInputCostPer1K * 1000000}/1M input tokens, ${batchOutputCostPer1K * 1000000}/1M output tokens\n\n`;
  
  // Company breakdown
  report += 'Company Breakdown:\n';
  report += '-------------------\n';
  
  // Get all company IDs from both regular and batch extraction
  const companyIds = new Set([...Object.keys(usageData.extraction), ...Object.keys(usageData.batchExtraction)]);
  
  if (companyIds.size === 0) {
    report += 'No company data recorded\n';
  } else {
    for (const companyId of [...companyIds].sort()) {
      // Regular extraction usage
      const regularUsage = usageData.extraction[companyId];
      if (regularUsage) {
        const estimatedFlag = regularUsage.isEstimated ? ' (estimated)' : '';
        report += `${companyId} (Regular)${estimatedFlag}: ${regularUsage.inputTokens} input + ${regularUsage.outputTokens} output = ${regularUsage.totalTokens} total tokens\n`;
      }
      
      // Batch extraction usage
      const batchUsage = usageData.batchExtraction[companyId];
      if (batchUsage) {
        const estimatedFlag = batchUsage.isEstimated ? ' (estimated)' : '';
        report += `${companyId} (Batch)${estimatedFlag}: ${batchUsage.inputTokens} input + ${batchUsage.outputTokens} output = ${batchUsage.totalTokens} total tokens\n`;
      }
    }
  }
  
  return report;
}

/**
 * Save the usage report to a file
 * @returns {Promise<string>} - Path to the saved report
 */
async function saveUsageReport() {
  const report = generateUsageReport();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(config.outputDir, `token_usage_report_${timestamp}.txt`);
  
  await fs.writeFile(reportPath, report);
  return reportPath;
}

/**
 * Save the full token usage data as JSON for later analysis
 * @returns {Promise<string>} - Path to the saved JSON file
 */
async function saveTokenUsage() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const usagePath = path.join(config.outputDir, `token_usage_data_${timestamp}.json`);
  
  await fs.writeFile(usagePath, JSON.stringify(usageData, null, 2));
  return usagePath;
}

const tokenTracker = {
  recordClaudeExtractionUsage,
  recordClaudeBatchExtractionUsage,
  generateUsageReport,
  saveUsageReport,
  saveTokenUsage
};

export default tokenTracker;