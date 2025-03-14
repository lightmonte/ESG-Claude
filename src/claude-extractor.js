/**
 * claude-extractor.js
 * 
 * This module implements direct PDF extraction using Claude's API.
 * It sends PDF URLs directly to Claude for ESG data extraction.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { logToFile, concurrentMap, sleep, ensureDirectoryExists, validatePdfUrl, validateWebsiteUrl, determineUrlType } from './utils.js';
import Anthropic from '@anthropic-ai/sdk';
import tokenTracker from './lib/token-tracker.js';
import * as persistence from './lib/persistence.js';
import esgCriteria from './lib/esg-criteria.js';
import errorHandler from './lib/error-handler.js';
import systemPrompt from './prompts/system-prompt.js';
import userPrompt from './prompts/user-prompt.js';
import websiteExtractor from './lib/extractors/website-extractor.js';

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
 * Extract structured ESG data from a source (PDF URL or website)
 */
export async function extractDataFromUrl(company) {
  const { companyId, name, url, industry, shouldUpdate } = company;
  
  // Skip if URL is missing
  if (!url) {
    return { 
      ...company, 
      status: 'extraction_skipped',
      message: 'URL not available'
    };
  }
  
  // Determine the type of URL (pdf, website, unknown)
  const urlType = determineUrlType(url);
  console.log(`URL type for ${companyId}: ${urlType}`);
  
  // Handle unknown URL type
  if (urlType === 'unknown') {
    console.warn(`The URL for ${companyId} does not appear to be a valid PDF or website: ${url}`);
    console.log(`The URL should be a valid PDF or website starting with http:// or https://`);
    
    // Update persistence with warning status
    await persistence.updateCompany(companyId, name, url);
    await persistence.updateProcessingStatus(
      companyId, 
      'extraction', 
      'extraction_skipped', 
      'URL does not appear to be a valid PDF or website'
    );
    
    return { 
      ...company, 
      status: 'extraction_skipped',
      message: 'URL does not appear to be a valid PDF or website'
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
    // Log extraction based on URL type
    if (urlType === 'pdf') {
      console.log(`Extracting ESG data from PDF URL for ${companyId}: ${url}`);
    } else { // website
      console.log(`Extracting ESG data from website for ${companyId}: ${url}`);
    }
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
    
    // Create the system prompt with the appropriate content type
    const sysPrompt = systemPrompt.createSystemPrompt(normalizedIndustry, false, urlType);
    
    // Different handling based on URL type
    let usrPrompt;
    let extractedWebContent = null;
    
    if (urlType === 'pdf') {
      // For PDFs, create the user prompt with the PDF URL
      usrPrompt = userPrompt.createUserPrompt(url, relevantCriteria, {
        includeCriteriaDescriptions: true,
        maxActions: process.env.MAX_ACTIONS_PER_CRITERION || 8,
        isBatch: false,
        contentType: 'pdf'
      });
    } else {
      // For websites, extract the content first
      console.log(`Extracting content from website: ${url}`);
      try {
        extractedWebContent = await websiteExtractor.extractWebsiteContent(url);
        console.log(`Successfully extracted website content: ${extractedWebContent.title}`);
        
        // Format the content for Claude
        const formattedContent = websiteExtractor.formatWebsiteContentForClaude(extractedWebContent);
        
        // Create the user prompt with the website content
        usrPrompt = userPrompt.createUserPrompt(url, relevantCriteria, {
          includeCriteriaDescriptions: true,
          maxActions: process.env.MAX_ACTIONS_PER_CRITERION || 8,
          isBatch: false,
          contentType: 'website',
          websiteContent: formattedContent
        });
      } catch (extractionError) {
        console.error(`Failed to extract website content: ${extractionError.message}`);
        // Update persistence with error status
        await persistence.updateProcessingStatus(
          companyId,
          'extraction',
          'extraction_failed',
          `Website content extraction failed: ${extractionError.message}`
        );
        return {
          ...company,
          error: `Website content extraction failed: ${extractionError.message}`,
          status: 'extraction_failed'
        };
      }
    }
    
    console.log(`Sending prompt to Claude for ${companyId}...`);
    
    // Send the request to Claude with URL in the prompt, with retry logic
    const response = await retryWithBackoff(async () => {
      return await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 8000,
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
    
    // Let's try to extract JSON properly with enhanced parsing techniques
    console.log(`Parsing response for ${companyId}...`);
    
    // Try multiple extraction strategies in order of reliability
    let extractedJson;
    let parseSuccess = false;
    let parseErrors = [];
    
    // Strategy 1: Simple JSON.parse if it's already valid JSON
    try {
      const trimmedResponse = responseText.trim();
      if (trimmedResponse.startsWith('{') && trimmedResponse.endsWith('}')) {
        extractedJson = JSON.parse(trimmedResponse);
        parseSuccess = true;
        console.log(`Successfully parsed JSON directly for ${companyId}`);
      }
    } catch (parseError) {
      parseErrors.push(`Direct JSON parsing: ${parseError.message}`);
      console.log(`Direct JSON parsing failed: ${parseError.message}`);
    }
    
    // Strategy 2: Try to extract JSON from markdown code blocks (more aggressive matching)
    if (!parseSuccess) {
      try {
        // Match both ```json and ``` format code blocks
        const jsonMatches = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/g);
        if (jsonMatches && jsonMatches.length > 0) {
          // Try each code block until one succeeds
          for (const match of jsonMatches) {
            try {
              const content = match.replace(/```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
              if (content.startsWith('{') && content.endsWith('}')) {
                extractedJson = JSON.parse(content);
                parseSuccess = true;
                console.log(`Successfully extracted JSON from code block for ${companyId}`);
                break;
              }
            } catch (blockError) {
              // Continue to next block
              console.log(`Code block parsing attempt failed, trying next block...`);
            }
          }
        }
        
        if (!parseSuccess && jsonMatches) {
          parseErrors.push(`Code block extraction: Found ${jsonMatches.length} potential blocks but none parsed successfully`);
        }
      } catch (codeBlockError) {
        parseErrors.push(`Code block extraction: ${codeBlockError.message}`);
        console.log(`Code block JSON parsing failed: ${codeBlockError.message}`);
      }
    }
    
    // Strategy 3: Try to extract anything that looks like a complete JSON object
    if (!parseSuccess) {
      try {
        // Find all potential JSON objects - looking for balanced {} with at least some content
        const potentialObjects = [];
        let depth = 0;
        let start = -1;
        
        for (let i = 0; i < responseText.length; i++) {
          if (responseText[i] === '{') {
            if (depth === 0) start = i;
            depth++;
          } else if (responseText[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
              potentialObjects.push(responseText.substring(start, i + 1));
              start = -1;
            }
          }
        }
        
        // Try each potential object
        for (const obj of potentialObjects) {
          if (obj.length > 50) { // Only try substantive objects to avoid fragments
            try {
              extractedJson = JSON.parse(obj);
              parseSuccess = true;
              console.log(`Successfully extracted complete JSON object from text for ${companyId}`);
              break;
            } catch (objError) {
              // Try next object
            }
          }
        }
        
        if (!parseSuccess && potentialObjects.length > 0) {
          parseErrors.push(`JSON object extraction: Found ${potentialObjects.length} potential objects but none parsed successfully`);
        }
      } catch (objectError) {
        parseErrors.push(`JSON object extraction: ${objectError.message}`);
        console.log(`JSON object extraction failed: ${objectError.message}`);
      }
    }
    
    // Strategy 4: Use the shared parser as a fallback
    if (!parseSuccess) {
      console.log(`Falling back to shared parser for ${companyId}...`);
      const parseResult = errorHandler.parseJSON(responseText);
      parseSuccess = parseResult.success;
      if (parseSuccess) {
        extractedJson = parseResult.data;
        console.log(`Successfully parsed JSON using the shared parser for ${companyId}`);
      } else {
        parseErrors.push(`Shared parser: ${parseResult.message || 'Failed with no specific error'}`);
      }
    }
    
    // Log detailed parsing attempts if all failed
    if (!parseSuccess) {
      console.error(`All JSON parsing strategies failed for ${companyId}:`);
      parseErrors.forEach((error, i) => console.error(`  Strategy ${i+1}: ${error}`));
    }
    
    if (parseSuccess) {
      let extractedData = extractedJson;
      
      // Add the industry to the extracted data
      extractedData.industry = normalizedIndustry;
      
      // Add the source type (pdf or website)
      extractedData.sourceType = urlType;
      
      // If companyDetails is missing, add an empty structure
      if (!extractedData.companyDetails) {
        extractedData.companyDetails = {
          legalEntityName: "",
          businessDescription: "",
          sector: "",
          address: {
            street: "",
            zipCode: "",
            city: "",
            country: ""
          },
          contactInfo: {
            phoneNumber: "",
            emailAddress: "",
            website: url || ""
          },
          foundingYear: "",
          employeeRange: "",
          revenueRange: ""
        };
      } else {
        // Ensure contactInfo exists
        extractedData.companyDetails.contactInfo = extractedData.companyDetails.contactInfo || {};
        // Ensure website is set if available
        extractedData.companyDetails.contactInfo.website = extractedData.companyDetails.contactInfo.website || url || "";
      }
      
      // Ensure carbonFootprint has the expected structure with years
      if (!extractedData.carbonFootprint) {
        extractedData.carbonFootprint = {
          scope1_2022: "",
          scope2_2022: "",
          scope3_2022: "",
          total_2022: "",
          scope1_2023: "",
          scope2_2023: "",
          scope3_2023: "",
          total_2023: "",
          scope1_2024: "",
          scope2_2024: "",
          scope3_2024: "",
          total_2024: ""
        };
      } else {
        // Handle backward compatibility with older format
        if (extractedData.carbonFootprint.scope1 && !extractedData.carbonFootprint.scope1_2023) {
          // Try to extract year from the format "x.xxx t CO2e (year)"
          const extractYear = (value) => {
            if (!value) return null;
            const match = value.match(/\((\d{4})\)/);
            return match ? match[1] : null;
          };
          
          const year = extractYear(extractedData.carbonFootprint.scope1) || '2023';
          
          // Move data to the appropriate year fields
          extractedData.carbonFootprint[`scope1_${year}`] = extractedData.carbonFootprint.scope1?.replace(/\s*\(\d{4}\)/, '') || '';
          extractedData.carbonFootprint[`scope2_${year}`] = extractedData.carbonFootprint.scope2?.replace(/\s*\(\d{4}\)/, '') || '';
          extractedData.carbonFootprint[`scope3_${year}`] = extractedData.carbonFootprint.scope3?.replace(/\s*\(\d{4}\)/, '') || '';
          extractedData.carbonFootprint[`total_${year}`] = extractedData.carbonFootprint.total?.replace(/\s*\(\d{4}\)/, '') || '';
          
          // Clean up old fields
          delete extractedData.carbonFootprint.scope1;
          delete extractedData.carbonFootprint.scope2;
          delete extractedData.carbonFootprint.scope3;
          delete extractedData.carbonFootprint.total;
        }
        
        // Ensure all year fields exist
        ['2022', '2023', '2024'].forEach(year => {
          ['scope1', 'scope2', 'scope3', 'total'].forEach(scope => {
            const key = `${scope}_${year}`;
            if (!extractedData.carbonFootprint[key]) {
              extractedData.carbonFootprint[key] = '';
            }
          });
        });
      }
      
      // If there are any missing criteria, add empty placeholders
      relevantCriteria.forEach(criterion => {
        if (!extractedData[criterion.id]) {
          extractedData[criterion.id] = {
            actions: ["# No specific actions found for " + criterion.name_en]
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
        sourceType: urlType,
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
        sourceType: urlType,
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
      sourceType: urlType,
      status: 'extraction_failed'
    };
  }
}

/**
 * Process all PDF URLs with direct extraction
 */
export async function processAllPdfUrls(companies) {
  console.log(`Starting direct extraction for ${companies.length} URLs (PDFs and websites)`);
  
  // Extract data with concurrency control
  const results = await concurrentMap(
    companies, 
    extractDataFromUrl,
    config.maxConcurrentExtractions // Use limited concurrency for API calls
  );
  
  // Summary
  const succeeded = results.filter(r => r.status === 'extraction_complete').length;
  const failed = results.filter(r => r.status === 'extraction_failed').length;
  const skipped = results.filter(r => r.status === 'extraction_skipped' || r.status === 'skipped').length;
  
  // Additional detailed summary by type
  const pdfExtracted = results.filter(r => r.sourceType === 'pdf' && r.status === 'extraction_complete').length;
  const websiteExtracted = results.filter(r => r.sourceType === 'website' && r.status === 'extraction_complete').length;
  
  console.log(`Direct extraction summary: ${succeeded} succeeded (${pdfExtracted} PDFs, ${websiteExtracted} websites), ${failed} failed, ${skipped} skipped`);
  
  return results;
}
