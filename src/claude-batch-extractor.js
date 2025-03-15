/**
 * claude-batch-extractor.js
 * 
 * This module implements batch processing using Claude's Message Batches API.
 * It allows for processing multiple PDFs in a single batch, with significant cost savings.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { logToFile, sleep, ensureDirectoryExists, validatePdfUrl, validateWebsiteUrl, determineUrlType } from './utils.js';
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
let isBatchAPIAvailable = false;
try {
  isBatchAPIAvailable = !!(anthropic && anthropic.messages && anthropic.messages.batches);
  console.log(`Batch API availability check: ${isBatchAPIAvailable ? 'Available' : 'Not available in current SDK version'}`);
  if (!isBatchAPIAvailable) {
    console.warn('WARNING: Batch API not available in the current Anthropic SDK version.');
    console.warn('Please update @anthropic-ai/sdk to version 0.19.0 or later, or disable batch processing.');
  }
} catch (error) {
  console.error(`Error checking batch API availability: ${error.message}`);
  console.warn('Setting batch API availability to false due to error.');
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
  
  // Prepare batch requests for valid PDF URLs
  const validCompanies = [];
  const invalidCompanies = [];
  
  // First validate all URLs
  for (const company of companies) {
    const { companyId, name, url } = company;
    
    // Determine URL type
    const urlType = determineUrlType(url);
    
    // Skip if URL is invalid
    if (urlType === 'unknown') {
      console.warn(`Skipping ${companyId} - URL does not appear to be a valid PDF or website: ${url}`);
      await persistence.updateCompany(companyId, name, url);
      await persistence.updateProcessingStatus(
        companyId, 
        'extraction', 
        'extraction_skipped', 
        'URL does not appear to be a valid PDF or website'
      );
      
      invalidCompanies.push({
        ...company,
        status: 'extraction_skipped',
        message: 'URL does not appear to be a valid PDF or website'
      });
    } else {
      // Currently, batch processing only supports PDFs
      if (urlType === 'pdf') {
        validCompanies.push(company);
      } else {
        console.warn(`Skipping ${companyId} for batch processing - Websites not supported in batch mode: ${url}`);
        console.log(`The website will be processed in direct extraction mode.`);
        await persistence.updateCompany(companyId, name, url);
        await persistence.updateProcessingStatus(
          companyId, 
          'extraction', 
          'extraction_skipped', 
          'Websites not supported in batch mode'
        );
        
        invalidCompanies.push({
          ...company,
          status: 'extraction_skipped',
          message: 'Websites not supported in batch mode'
        });
      }
    }
  }
  
  // Log the results of the validation
  if (invalidCompanies.length > 0) {
    console.log(`Skipped ${invalidCompanies.length} companies with invalid PDF URLs`);
  }
  console.log(`Processing ${validCompanies.length} companies with valid PDF URLs`);
  
  // Prepare batch requests only for valid URLs
  const batchRequests = await Promise.all(validCompanies.map(async company => {
    const { companyId, name, url, industry, customPrompt } = company;
    
    // Use the industry as-is from hardcoded data
    let normalizedIndustry = industry || '';
    console.log(`Getting criteria for industry: ${normalizedIndustry}`);
    
    // Get relevant criteria for this industry from hardcoded data
    const relevantCriteria = await esgCriteria.getIndustryCriteria(normalizedIndustry);
    
    // Log the actual criteria being used for debugging
    const criteriaNames = relevantCriteria.map(c => c.name_en || c.id);
    console.log(`Using ${relevantCriteria.length} relevant criteria for ${normalizedIndustry || 'unknown industry'}`);
    console.log('Criteria used:', criteriaNames.join(', '));
    
    // Determine which prompt to use - custom or standard
    let requestParams;
    
    if (customPrompt && customPrompt.trim()) {
      console.log(`Using custom prompt from company_urls.csv file for ${companyId} in batch mode`);
      // Adjust the PDF URL reference if present in the custom prompt
      let adjustedCustomPrompt = customPrompt;
      if (adjustedCustomPrompt.includes('The PDF is attached.')) {
        adjustedCustomPrompt = adjustedCustomPrompt.replace('The PDF is attached.', `The PDF URL is: ${url}`);
      }
      
      requestParams = {
        model: config.claudeModel,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: adjustedCustomPrompt
              }
            ]
          }
        ],
        temperature: 0.2
      };
    } else {
      // Create the standard extraction prompts using the shared prompt modules
      const sysPrompt = systemPrompt.createSystemPrompt(normalizedIndustry, true);
      const usrPrompt = userPrompt.createUserPrompt(url, relevantCriteria, {
        includeCriteriaDescriptions: false,
        maxActions: 5,
        isBatch: true
      });
      
      requestParams = {
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
      };
    }
    
    return {
      custom_id: companyId,
      params: requestParams
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
            
            // First, check if this might be XML format from a custom prompt
            let parseResult;
            const hasXmlStructure = responseText.includes('<sustainability_analysis>') && responseText.includes('</sustainability_analysis>');
            
            if (hasXmlStructure) {
              console.log(`Detected XML structure in batch response for ${companyId}, attempting to extract`);
              try {
                // Extract data from XML sustainability_analysis tags
                const xmlMatch = responseText.match(/<sustainability_analysis>[\s\S]*?<\/sustainability_analysis>/g);
                
                if (xmlMatch && xmlMatch.length > 0) {
                  // Process the XML similar to the logic in claude-extractor.js
                  const xmlContent = xmlMatch[0];
                  
                  // Extract fields from XML content
                  const extractXMLValue = (fieldName) => {
                    const regex = new RegExp(`<${fieldName}>(.*?)<\/${fieldName}>`, 's');
                    const match = xmlContent.match(regex);
                    return match ? match[1].trim() : '';
                  };
                  
                  // Function to process action text
                  const processActions = (text) => {
                    if (!text || text.trim() === '') {
                      return ['# No specific actions found'];
                    }
                    return text
                      .split('#')
                      .filter(item => item.trim())
                      .map(item => '# ' + item.trim());
                  };
                  
                  // Make sure we're capturing the correct company name
                  const companyName = extractXMLValue('company') || company.name || companyId;
                  
                  // Transform the XML data to our JSON structure with proper initialization
                  const mappedData = {
                    basicInformation: {
                      companyName: companyName,
                      reportYear: new Date().getFullYear().toString(),
                      reportTitle: extractXMLValue('file_name') || `Sustainability Report for ${companyName}`
                    },
                    abstract: extractXMLValue('abstract') || '',
                    highlights: {
                      courage: extractXMLValue('highlight_courage') || '',
                      action: extractXMLValue('highlight_action') || '',
                      solution: extractXMLValue('highlight_solution') || ''
                    },
                    buildings: {
                      actions: processActions(extractXMLValue('criteria1_actions_solutions'))
                    },
                    energy_efficiency: {
                      actions: processActions(extractXMLValue('criteria2_actions_solutions'))
                    },
                    renewable_energies: {
                      actions: processActions(extractXMLValue('criteria3_actions_solutions'))
                    },
                    climate_neutral_operation: {
                      actions: processActions(extractXMLValue('criteria4_actions_solutions'))
                    },
                    materials: {
                      actions: processActions(extractXMLValue('criteria5_actions_solutions'))
                    },
                    occupational_safety_and_health: {
                      actions: processActions(extractXMLValue('criteria6_actions_solutions'))
                    },
                    carbon_footprint: {
                      actions: processActions(extractXMLValue('criteria7_actions_solutions'))
                    },
                    carbonFootprint: {
                      scope1_2022: extractXMLValue('co2_scope1_2022') || '',
                      scope2_2022: extractXMLValue('co2_scope2_2022') || '',
                      scope3_2022: extractXMLValue('co2_scope3_2022') || '',
                      total_2022: extractXMLValue('co2_total_2022') || '',
                      scope1_2023: extractXMLValue('co2_scope1_2023') || '',
                      scope2_2023: extractXMLValue('co2_scope2_2023') || '',
                      scope3_2023: extractXMLValue('co2_scope3_2023') || '',
                      total_2023: extractXMLValue('co2_total_2023') || '',
                      scope1_2024: extractXMLValue('co2_scope1_2024') || '',
                      scope2_2024: extractXMLValue('co2_scope2_2024') || '',
                      scope3_2024: extractXMLValue('co2_scope3_2024') || '',
                      total_2024: extractXMLValue('co2_total_2024') || ''
                    },
                    climateStandards: {
                      iso14001: extractXMLValue('climate_standard_iso_14001') || 'No',
                      iso50001: extractXMLValue('climate_standard_iso_50001') || 'No',
                      emas: extractXMLValue('climate_standard_emas') || 'No',
                      cdp: extractXMLValue('climate_standard_cdp') || 'No',
                      sbti: extractXMLValue('climate_standard_sbti') || 'No'
                    },
                    otherInitiatives: extractXMLValue('other') || '',
                    controversies: extractXMLValue('controversies') || '',
                    companyDetails: {
                      legalEntityName: extractXMLValue('company') || companyName,
                      businessDescription: '',
                      sector: company.industry || '',
                      address: {
                        street: '',
                        zipCode: '',
                        city: '',
                        country: ''
                      },
                      contactInfo: {
                        phoneNumber: '',
                        emailAddress: '',
                        website: company.url || ''
                      },
                      foundingYear: '',
                      employeeRange: '',
                      revenueRange: ''
                    }
                  };
                  
                  parseResult = {
                    success: true,
                    data: mappedData
                  };
                } else {
                  // Fall back to standard JSON parser if XML structure not found
                  parseResult = errorHandler.parseJSON(responseText);
                }
              } catch (xmlError) {
                console.error(`Error parsing XML in batch response for ${companyId}: ${xmlError.message}`);
                // Fall back to standard JSON parser
                parseResult = errorHandler.parseJSON(responseText);
              }
            } else {
              // Use the standard JSON parser
              parseResult = errorHandler.parseJSON(responseText);
            }
            
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