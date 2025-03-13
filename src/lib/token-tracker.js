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
  if (!apiResponse || !apiResponse.usage) {
    console.warn(`No usage data available for ${companyId}`);
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
  console.log(`Recording batch token usage: ${companyId} with ${inputTokens} input, ${outputTokens} output tokens`);
  // Record company-specific usage
  usageData.batchExtraction[companyId] = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    timestamp: new Date().toISOString(),
    isBatch: true
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
  // Regular API pricing
  const regularInputCostPer1K = 3.00 / 1000000;  // $3 per 1M input tokens
  const regularOutputCostPer1K = 15.00 / 1000000; // $15 per 1M output tokens
  
  // Batch API pricing (50% of regular)
  const batchInputCostPer1K = 1.50 / 1000000;  // $1.50 per 1M input tokens
  const batchOutputCostPer1K = 7.50 / 1000000; // $7.50 per 1M output tokens
  
  // Count tokens by type
  let regularInputTokens = 0;
  let regularOutputTokens = 0;
  let batchInputTokens = 0;
  let batchOutputTokens = 0;
  
  // Count regular extraction tokens
  Object.values(usageData.extraction).forEach(usage => {
    regularInputTokens += usage.inputTokens;
    regularOutputTokens += usage.outputTokens;
  });
  
  // Count batch extraction tokens
  Object.values(usageData.batchExtraction).forEach(usage => {
    batchInputTokens += usage.inputTokens;
    batchOutputTokens += usage.outputTokens;
  });
  
  // Calculate costs
  const regularInputCost = (regularInputTokens * regularInputCostPer1K).toFixed(4);
  const regularOutputCost = (regularOutputTokens * regularOutputCostPer1K).toFixed(4);
  const regularTotalCost = (parseFloat(regularInputCost) + parseFloat(regularOutputCost)).toFixed(4);
  
  const batchInputCost = (batchInputTokens * batchInputCostPer1K).toFixed(4);
  const batchOutputCost = (batchOutputTokens * batchOutputCostPer1K).toFixed(4);
  const batchTotalCost = (parseFloat(batchInputCost) + parseFloat(batchOutputCost)).toFixed(4);
  
  const totalCost = (parseFloat(regularTotalCost) + parseFloat(batchTotalCost)).toFixed(4);
  
  // Build the report
  let report = '\n=== Claude API Token Usage Report ===\n\n';
  
  // Regular API usage
  report += 'Regular API Usage:\n';
  report += '-----------------\n';
  report += `Regular API Calls: ${usageData.calls}\n`;
  report += `Regular Input Tokens: ${regularInputTokens.toLocaleString()}\n`;
  report += `Regular Output Tokens: ${regularOutputTokens.toLocaleString()}\n`;
  report += `Regular Total Tokens: ${(regularInputTokens + regularOutputTokens).toLocaleString()}\n`;
  report += `Regular API Cost: ${regularTotalCost}\n\n`;
  
  // Batch API usage
  report += 'Batch API Usage:\n';
  report += '----------------\n';
  report += `Batch API Calls: ${usageData.batchCalls}\n`;
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
        report += `${companyId} (Regular): ${regularUsage.inputTokens} input + ${regularUsage.outputTokens} output = ${regularUsage.totalTokens} total tokens\n`;
      }
      
      // Batch extraction usage
      const batchUsage = usageData.batchExtraction[companyId];
      if (batchUsage) {
        report += `${companyId} (Batch): ${batchUsage.inputTokens} input + ${batchUsage.outputTokens} output = ${batchUsage.totalTokens} total tokens\n`;
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