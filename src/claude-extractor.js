/**
 * claude-extractor.js
 * 
 * This module implements direct PDF extraction using Claude's API.
 * It sends PDF URLs directly to Claude for ESG data extraction.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { logToFile, concurrentMap, sleep, ensureDirectoryExists } from './utils.js';
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

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelay - Initial delay in milliseconds
 * @returns {Promise<any>} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 2000) {
  let retries = 0;
  let delay = initialDelay;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      
      // Use the shared error handler to check if the error is retryable
      if (retries > maxRetries || !errorHandler.isRetryableError(error, retries, maxRetries)) {
        throw error;
      }
      
      console.log(`API overloaded or rate limited. Retrying in ${delay/1000} seconds (attempt ${retries}/${maxRetries})...`);
      await sleep(delay);
      
      // Exponential backoff with jitter
      delay = delay * 2 + Math.floor(Math.random() * 1000);
    }
  }
}

/**
 * Extract structured ESG data directly from a PDF URL
 */
export async function extractDataFromPdfUrl(company) {
  const { companyId, name, url, industry, shouldUpdate } = company;
  
  // Skip if URL is missing
  if (!url) {
    return { 
      ...company, 
      status: 'extraction_skipped',
      message: 'PDF URL not available'
    };
  }
  
  // Skip if shouldUpdate is explicitly false
  if (shouldUpdate === false) {
    console.log(`Skipping extraction for ${companyId} based on shouldUpdate flag`);
    return { 
      ...company, 
      status: 'skipped', 
      message: 'Skipped based on shouldUpdate flag' 
    };
  }
  
  try {
    console.log(`Extracting ESG data from PDF URL for ${companyId}: ${url}`);
    console.log(`Industry: ${industry || 'not specified'}`);
    
    // Use the industry as-is from the hardcoded data
    let normalizedIndustry = industry || '';
    console.log(`Using industry: ${normalizedIndustry}`);
    
    // Get industry-specific criteria from the hardcoded data
    const relevantCriteria = await esgCriteria.getIndustryCriteria(normalizedIndustry);
    console.log(`Using ${relevantCriteria.length} relevant criteria for ${normalizedIndustry || 'unknown industry'}`);
    
    // Log the actual criteria being used for debugging
    const criteriaNames = relevantCriteria.map(c => c.name_en || c.id);
    console.log('Criteria used:', criteriaNames.join(', '));
    
    // Create the extraction prompt
    const sysPrompt = systemPrompt.createSystemPrompt(normalizedIndustry);
    const usrPrompt = userPrompt.createUserPrompt(url, relevantCriteria, {
      includeCriteriaDescriptions: false,
      maxActions: 5,
      isBatch: false
    });
    
    console.log(`Sending prompt to Claude for ${companyId}...`);
    
    // Send the request to Claude with URL in the prompt, with retry logic
    const response = await retryWithBackoff(async () => {
      return await anthropic.messages.create({
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
      });
    });
    
    // Record token usage
    tokenTracker.recordClaudeExtractionUsage(companyId, response);
    
    // Log token usage summary
    console.log(`Token usage for ${companyId}: ${response.usage?.input_tokens || 0} input + ${response.usage?.output_tokens || 0} output tokens`);
    await logToFile(`Token usage for ${companyId}: ${response.usage?.input_tokens || 0} input + ${response.usage?.output_tokens || 0} output tokens`);
    
    // Process Claude's response
    const responseText = response.content[0].text;
    
    // Ensure output directories exist
    const debugDir = path.join(config.outputDir, 'raw_responses');
    await ensureDirectoryExists(debugDir);
    
    // Save raw response for potential debugging or manual recovery later
    await fs.writeFile(
      path.join(debugDir, `${companyId}_raw_response.txt`),
      responseText
    );
    
    // Let's try to extract JSON properly
    console.log(`Parsing response for ${companyId}...`);
    
    // Try different extraction strategies
    let extractedJson;
    let parseSuccess = false;
    
    // Strategy 1: Simple JSON.parse if it's already valid JSON
    try {
      if (responseText.trim().startsWith('{') && responseText.trim().endsWith('}')) {
        extractedJson = JSON.parse(responseText.trim());
        parseSuccess = true;
        console.log(`Successfully parsed JSON directly for ${companyId}`);
      }
    } catch (parseError) {
      console.log(`Direct JSON parsing failed: ${parseError.message}`);
    }
    
    // Strategy 2: Try to extract JSON from markdown code blocks
    if (!parseSuccess) {
      try {
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          extractedJson = JSON.parse(jsonMatch[1].trim());
          parseSuccess = true;
          console.log(`Successfully extracted JSON from code block for ${companyId}`);
        }
      } catch (codeBlockError) {
        console.log(`Code block JSON parsing failed: ${codeBlockError.message}`);
      }
    }
    
    // Strategy 3: Try to extract anything that looks like a JSON object
    if (!parseSuccess) {
      try {
        const potentialJson = responseText.match(/{[\s\S]*}/);
        if (potentialJson && potentialJson[0]) {
          extractedJson = JSON.parse(potentialJson[0]);
          parseSuccess = true;
          console.log(`Successfully extracted JSON object from text for ${companyId}`);
        }
      } catch (objectError) {
        console.log(`JSON object extraction failed: ${objectError.message}`);
      }
    }
    
    // Use the shared parser as a fallback
    if (!parseSuccess) {
      console.log(`Falling back to shared parser for ${companyId}...`);
      const parseResult = errorHandler.parseJSON(responseText);
      parseSuccess = parseResult.success;
      if (parseSuccess) {
        extractedJson = parseResult.data;
      }
    }
    
    if (parseSuccess) {
      let extractedData = extractedJson;
      
      // Add the industry to the extracted data
      extractedData.industry = normalizedIndustry;
      
      // If there are any missing criteria, add empty placeholders
      relevantCriteria.forEach(criterion => {
        if (!extractedData[criterion.id]) {
          extractedData[criterion.id] = {
            actions: ["# No specific actions found for " + criterion.name_en],
            extracts: "No relevant information found in the report for " + criterion.name_en
          };
        }
      });
      
      console.log(`Successfully extracted ESG data for ${companyId}`);
      
      // Save extracted data to file
      const outputDir = path.join(config.outputDir, 'extracted');
      await ensureDirectoryExists(outputDir);
      
      await fs.writeFile(
        path.join(outputDir, `${companyId}_extracted.json`),
        JSON.stringify(extractedData, null, 2)
      );
      
      // Update processing status
      await persistence.updateCompany(companyId, name, url);
      await persistence.updateProcessingStatus(companyId, 'extraction', 'extraction_complete');
  console.log(`✓ Successfully extracted data for ${companyId} with ${Object.keys(extractedData).length} fields including ${relevantCriteria.length} criteria`);
      
      return {
        companyId,
        name,
        url,
        industry: normalizedIndustry,
        extractedData,
        status: 'extraction_complete'
      };
    } else {
      // JSON parsing failed
      const errorMessage = "Failed to parse JSON from Claude response";
      
      console.error(`Error parsing JSON from Claude response for ${companyId}: ${errorMessage}`);
      await logToFile(`Error parsing JSON from Claude response for ${companyId}: ${errorMessage}`);
      
      // Attempt to create a basic structure with the raw response with more descriptive content
      const fallbackData = {
        basicInformation: {
          companyName: name || companyId,
          reportYear: "Unknown",
          reportTitle: "Unknown"
        },
        industry: normalizedIndustry,
        // Add explicit error info to make it clear why this is empty
        extractionError: "Failed to parse Claude's response into valid JSON format",
        // Add placeholders for expected criteria to avoid empty cells
        ...relevantCriteria.reduce((acc, criterion) => {
          acc[criterion.id] = {
            actions: ["# Could not extract data for " + criterion.name_en],
            extracts: "Error processing this criterion - extraction failed"
          };
          return acc;
        }, {}),
        rawResponse: responseText.substring(0, 1000) + "..." // Truncated for storage
      };
      
      // Update processing status - mark as failed for JSON parsing
      await persistence.updateCompany(companyId, name, url);
      await persistence.updateProcessingStatus(companyId, 'extraction', 'extraction_failed', errorMessage);
      
      // Return the fallback data with error status
      return {
        companyId,
        name,
        url,
        industry: normalizedIndustry,
        rawResponse: responseText,
        fallbackData, // Include our simple fallback data
        error: errorMessage,
        status: 'extraction_failed'
      };
    }
  } catch (error) {
    // Use the shared error handler
    await errorHandler.handleError('Extraction', error, companyId);
    
    // Make sure normalizedIndustry is defined even in the error handler
    let normalizedIndustry = industry || '';
    if (normalizedIndustry && normalizedIndustry.includes('_')) {
      const parts = normalizedIndustry.split('_');
      normalizedIndustry = parts[parts.length - 1];
    }
    
    // Update processing status
    await persistence.updateCompany(companyId, name, url);
    await persistence.updateProcessingStatus(companyId, 'extraction', 'extraction_failed', error.message);
    
    return {
      companyId,
      name,
      url,
      industry: normalizedIndustry,
      error: error.message,
      status: 'extraction_failed'
    };
  }
}

/**
 * Process all PDF URLs with direct extraction
 */
export async function processAllPdfUrls(companies) {
  console.log(`Starting direct extraction for ${companies.length} PDF URLs`);
  
  // Extract data with concurrency control
  const results = await concurrentMap(
    companies, 
    extractDataFromPdfUrl,
    config.maxConcurrentExtractions // Use limited concurrency for API calls
  );
  
  // Summary
  const succeeded = results.filter(r => r.status === 'extraction_complete').length;
  const failed = results.filter(r => r.status === 'extraction_failed').length;
  const skipped = results.filter(r => r.status === 'extraction_skipped' || r.status === 'skipped').length;
  
  console.log(`Direct extraction summary: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
  
  return results;
}