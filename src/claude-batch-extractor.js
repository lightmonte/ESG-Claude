/**
 * claude-batch-extractor.js
 * 
 * This module implements batch processing using Claude's Message Batches API.
 * It allows for processing multiple PDFs in a single batch, with significant cost savings.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { logToFile, sleep, ensureDirectoryExists } from './utils.js';
import Anthropic from '@anthropic-ai/sdk';
import tokenTracker from './lib/token-tracker.js';
import * as persistence from './lib/persistence.js';
import esgCriteria from './lib/esg-criteria.js';
import errorHandler from './lib/error-handler.js';
import systemPrompt from './prompts/system-prompt.js';
import userPrompt from './prompts/user-prompt.js';

// Initialize the Claude client
const anthropic = new Anthropic({
  apiKey: config.claudeApiKey
});

// Check if batch API is available
const isBatchAPIAvailable = !!(anthropic && anthropic.messages && anthropic.messages.batches);
console.log(`Batch API availability check: ${isBatchAPIAvailable ? 'Available' : 'Not available in current SDK version'}`);
if (!isBatchAPIAvailable) {
  console.warn('WARNING: Batch API not available in the current Anthropic SDK version.');
  console.warn('Please update @anthropic-ai/sdk to version 0.19.0 or later, or disable batch processing.');
}

/**
 * Create a batch extraction request for multiple companies
 * @param {Array} companies - Array of company objects to process in batch
 * @returns {Promise<Object>} - Object with batch ID and other metadata
 */
export async function createBatchExtractionRequest(companies) {
  console.log(`Creating batch extraction request for ${companies.length} companies`);
  
  // Check if batch API is available
  if (!isBatchAPIAvailable) {
    throw new Error('Batch API is not available in the current Anthropic SDK version. Please update @anthropic-ai/sdk or disable batch processing by setting USE_BATCH_PROCESSING=false in .env');
  }
  
  // Prepare batch requests
  const batchRequests = await Promise.all(companies.map(async company => {
    const { companyId, name, url, industry } = company;
    
    // Use the industry as-is from hardcoded data
    let normalizedIndustry = industry || '';
    console.log(`Getting criteria for industry: ${normalizedIndustry}`);
    
    // Get relevant criteria for this industry from hardcoded data
    const relevantCriteria = await esgCriteria.getIndustryCriteria(normalizedIndustry);
    
    // Log the actual criteria being used for debugging
    const criteriaNames = relevantCriteria.map(c => c.name_en || c.id);
    console.log(`Using ${relevantCriteria.length} relevant criteria for ${normalizedIndustry || 'unknown industry'}`);
    console.log('Criteria used:', criteriaNames.join(', '));
    
    // Create the extraction prompts using the shared prompt modules
    const sysPrompt = systemPrompt.createSystemPrompt(normalizedIndustry, true);
    const usrPrompt = userPrompt.createUserPrompt(url, relevantCriteria, {
      includeCriteriaDescriptions: false,
      maxActions: 5,
      isBatch: true
    });
    
    return {
      custom_id: companyId,
      params: {
        model: config.claudeModel,
        max_tokens: 4000,
        system: sysPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: usrPrompt
              }
            ]
          }
        ],
        temperature: 0.2
      }
    };
  }));
  
  // Create the batch request
  try {
    // First, mark all companies as in_progress
    for (const company of companies) {
      await persistence.updateCompany(company.companyId, company.name, company.url);
      await persistence.updateProcessingStatus(
        company.companyId, 
        'extraction', 
        'extraction_in_progress', 
        'Added to batch processing queue'
      );
    }
    
    // Create the batch
    const messageBatch = await anthropic.messages.batches.create({
      requests: batchRequests
    });
    
    console.log(`Created batch with ID: ${messageBatch.id}`);
    console.log(`Batch status: ${messageBatch.processing_status}`);
    console.log(`Requests in processing: ${messageBatch.request_counts.processing}`);
    
    // Store batch information for tracking
    await persistence.storeBatchInfo(messageBatch.id, companies.map(c => c.companyId));
    
    return messageBatch;
  } catch (error) {
    // Use the shared error handler for consistent formatting
    await errorHandler.handleError('Batch creation', error);
    
    // Mark all companies as failed
    for (const company of companies) {
      await persistence.updateProcessingStatus(
        company.companyId, 
        'extraction', 
        'extraction_failed', 
        `Failed to create batch: ${error.message}`
      );
    }
    
    throw error;
  }
}

/**
 * Check the status of a batch extraction request
 * @param {string} batchId - ID of the batch to check
 * @returns {Promise<Object>} - Current batch status
 */
export async function checkBatchStatus(batchId) {
  try {
    const messageBatch = await anthropic.messages.batches.retrieve(batchId);
    
    console.log(`Batch ${batchId} status: ${messageBatch.processing_status}`);
    console.log(`Processing: ${messageBatch.request_counts.processing}`);
    console.log(`Succeeded: ${messageBatch.request_counts.succeeded}`);
    console.log(`Errored: ${messageBatch.request_counts.errored}`);
    console.log(`Canceled: ${messageBatch.request_counts.canceled}`);
    console.log(`Expired: ${messageBatch.request_counts.expired}`);
    
    return messageBatch;
  } catch (error) {
    await errorHandler.handleError('Batch status check', error, batchId);
    throw error;
  }
}

/**
 * Process batch extraction results
 * @param {string} batchId - ID of the batch to process results for
 * @returns {Promise<Array>} - Array of processing results
 */
export async function processBatchResults(batchId) {
  try {
    console.log(`Processing results for batch ${batchId}`);
    
    // Get batch info to check if it's ready
    const batch = await checkBatchStatus(batchId);
    
    // If batch is still processing, return the current status
    if (batch.processing_status !== 'ended') {
      console.log(`Batch ${batchId} is still processing. Current status: ${batch.processing_status}`);
      return { status: 'in_progress', batch };
    }
    
    // Get company IDs associated with this batch
    const companyIds = await persistence.getBatchCompanyIds(batchId);
    console.log(`Batch ${batchId} contains ${companyIds.length} companies`);
    
    // Create a map to store results
    const results = [];
    
    // Get all companies associated with this batch for reference
    const companies = await Promise.all(
      companyIds.map(companyId => persistence.getCompany(companyId))
    );
    const companyMap = {};
    for (const company of companies) {
      if (company) {
        companyMap[company.company_id] = company;
      }
    }
    
    // Retrieve and process batch results
    console.log(`Retrieving results for batch ${batchId}`);
    
    // Create debug output directory if it doesn't exist
    const debugDir = path.join(config.outputDir, 'raw_responses');
    await ensureDirectoryExists(debugDir);
    
    // Create extracted data directory if it doesn't exist
    const extractedDir = path.join(config.outputDir, 'extracted');
    await ensureDirectoryExists(extractedDir);
    
    // Stream and process results
    try {
      // Stream results file in memory-efficient chunks
      for await (const result of await anthropic.messages.batches.results(batchId)) {
        const companyId = result.custom_id;
        const company = companyMap[companyId];
        
        // Skip if we can't find the company (shouldn't happen)
        if (!company) {
          console.warn(`Company not found for ID ${companyId} in batch ${batchId}`);
          continue;
        }
        
        // Process result based on type
        switch (result.result.type) {
          case 'succeeded': {
            const responseText = result.result.message.content[0].text;
            
            // Save raw response for debugging
            await fs.writeFile(
              path.join(debugDir, `${companyId}_raw_response.txt`),
              responseText
            );
            
            // Record token usage
            const inputTokens = result.result.message.usage.input_tokens;
            const outputTokens = result.result.message.usage.output_tokens;
            console.log(`Batch token usage for ${companyId}: ${inputTokens} input + ${outputTokens} output`);
            tokenTracker.recordClaudeBatchExtractionUsage(
              companyId, 
              inputTokens,
              outputTokens
            );
            
            // Try to extract JSON data using the shared parser
            const parseResult = errorHandler.parseJSON(responseText);
            
            if (parseResult.success) {
              const extractedData = parseResult.data;
              
              // Add industry information if available
              if (company.industry) {
                extractedData.industry = company.industry;
              }
              
              // Get relevant criteria for this industry to ensure all expected criteria are present
              const relevantCriteria = await esgCriteria.getIndustryCriteria(company.industry || "");
              
              // If there are any missing criteria, add them to ensure consistent data structure
              relevantCriteria.forEach(criterion => {
                if (!extractedData[criterion.id]) {
                  extractedData[criterion.id] = {
                    actions: ["# No specific actions found for " + criterion.name_en],
                    extracts: "No relevant information found in the report for " + criterion.name_en
                  };
                }
              });
              
              // Save extracted data to file
              await fs.writeFile(
                path.join(extractedDir, `${companyId}_extracted.json`),
                JSON.stringify(extractedData, null, 2)
              );
              
              // Update processing status
              await persistence.updateProcessingStatus(
                companyId, 
                'extraction', 
                'extraction_complete'
              );
              
              // Add to results
              results.push({
                companyId,
                name: company.name,
                url: company.url,
                extractedData,
                status: 'extraction_complete'
              });
              
              console.log(`Successfully extracted ESG data for ${companyId}`);
            } else {
              // JSON parsing failed
              const errorMessage = parseResult.message;
              
              console.error(`Error parsing JSON for ${companyId}: ${errorMessage}`);
              
              // Update processing status - mark as failed for JSON parsing
              await persistence.updateProcessingStatus(
                companyId, 
                'extraction', 
                'extraction_failed', 
                `JSON parsing error: ${errorMessage}`
              );
              
              // Create fallback data with more descriptive content
              const fallbackData = {
                basicInformation: {
                  companyName: company.name || companyId,
                  reportYear: "Unknown",
                  reportTitle: "Unknown"
                },
                // Add placeholder for industry-specific criteria
                industry: company.industry || "Unknown",
                // Add explicit error info to make it clear why this is empty
                extractionError: "Failed to parse Claude's response into valid JSON format",
                rawResponse: responseText.substring(0, 1000) + "..." // Truncated for storage
              };
              
              // Add to results with error
              results.push({
                companyId,
                name: company.name,
                url: company.url,
                rawResponse: responseText,
                fallbackData,
                error: errorMessage,
                status: 'extraction_failed'
              });
            }
            break;
          }
          
          case 'errored': {
            console.error(`Error processing ${companyId}: ${result.result.error.message}`);
            
            // Update processing status
            await persistence.updateProcessingStatus(
              companyId, 
              'extraction', 
              'extraction_failed', 
              `Batch processing error: ${result.result.error.message}`
            );
            
            // Add to results with error
            results.push({
              companyId,
              name: company.name,
              url: company.url,
              error: result.result.error.message,
              status: 'extraction_failed'
            });
            break;
          }
          
          case 'expired': {
            console.error(`Request for ${companyId} expired`);
            
            // Update processing status
            await persistence.updateProcessingStatus(
              companyId, 
              'extraction', 
              'extraction_failed', 
              'Batch request expired after 24 hours'
            );
            
            // Add to results with error
            results.push({
              companyId,
              name: company.name,
              url: company.url,
              error: 'Batch request expired after 24 hours',
              status: 'extraction_failed'
            });
            break;
          }
          
          case 'canceled': {
            console.warn(`Request for ${companyId} was canceled`);
            
            // Update processing status
            await persistence.updateProcessingStatus(
              companyId, 
              'extraction', 
              'extraction_failed', 
              'Batch request was canceled'
            );
            
            // Add to results with error
            results.push({
              companyId,
              name: company.name,
              url: company.url,
              error: 'Batch request was canceled',
              status: 'extraction_failed'
            });
            break;
          }
        }
      }
    } catch (error) {
      await errorHandler.handleError('Batch results streaming', error, batchId);
      throw error;
    }
    
    // Update batch status
    await persistence.updateBatchStatus(batchId, 'completed');
    
    // Log summary
    const succeeded = results.filter(r => r.status === 'extraction_complete').length;
    const failed = results.filter(r => r.status === 'extraction_failed').length;
    
    console.log(`Batch ${batchId} processing complete: ${succeeded} succeeded, ${failed} failed`);
    await logToFile(`Batch ${batchId} processing complete: ${succeeded} succeeded, ${failed} failed`);
    
    return { status: 'completed', results };
  } catch (error) {
    await errorHandler.handleError('Batch results processing', error, batchId);
    
    // Update batch status to error
    await persistence.updateBatchStatus(batchId, 'error', error.message);
    
    throw error;
  }
}

/**
 * Process a batch of companies using the batch extraction API
 * @param {Array} companies - Array of company objects to process
 * @returns {Promise<Object>} - Object with batch ID and initial status
 */
export async function processBatchCompanies(companies) {
  try {
    // Create batch request
    const batch = await createBatchExtractionRequest(companies);
    
    console.log(`Created batch with ID: ${batch.id}`);
    console.log(`Initial status: ${batch.processing_status}`);
    
    return {
      batchId: batch.id,
      status: batch.processing_status,
      companies: companies.length,
      message: `Batch created successfully. Check status with batch ID: ${batch.id}`
    };
  } catch (error) {
    await errorHandler.handleError('Batch processing', error);
    throw error;
  }
}

/**
 * Check all active batches and process completed ones
 * @returns {Promise<Array>} - Array of processed batch results
 */
export async function checkAndProcessCompletedBatches() {
  try {
    // Get all active batches
    const activeBatches = await persistence.getActiveBatches();
    console.log(`Found ${activeBatches.length} active batches to check`);
    
    const results = [];
    
    // Check each batch
    for (const batch of activeBatches) {
      try {
        const batchStatus = await checkBatchStatus(batch.batch_id);
        
        // If batch is complete, process the results
        if (batchStatus.processing_status === 'ended') {
          console.log(`Batch ${batch.batch_id} has ended, processing results...`);
          const batchResults = await processBatchResults(batch.batch_id);
          results.push(batchResults);
        } else {
          console.log(`Batch ${batch.batch_id} is still processing (${batchStatus.processing_status})`);
          console.log(`Processing: ${batchStatus.request_counts.processing}, Succeeded: ${batchStatus.request_counts.succeeded}, Errored: ${batchStatus.request_counts.errored}`);
          
          // Check if the batch is about to expire
          const created = new Date(batchStatus.created_at);
          const now = new Date();
          const hoursElapsed = (now - created) / (1000 * 60 * 60);
          
          if (hoursElapsed > 22) {
            console.warn(`⚠️ Batch ${batch.batch_id} has been processing for ${hoursElapsed.toFixed(1)} hours and may expire soon!`);
            await logToFile(`⚠️ Batch ${batch.batch_id} has been processing for ${hoursElapsed.toFixed(1)} hours and may expire soon!`);
          }
        }
      } catch (error) {
        await errorHandler.handleError('Batch check', error, batch.batch_id);
        await logToFile(`Error checking batch ${batch.batch_id}: ${error.message}`);
      }
    }
    
    return results;
  } catch (error) {
    await errorHandler.handleError('Batch checking', error);
    throw error;
  }
}