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
import industryPrompts from './lib/data/industry-prompts.js';
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
  const { companyId, name, url, industry, shouldUpdate, customPrompt } = company;
  
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
    
    // Normalize the industry to lowercase for better matching
    let normalizedIndustry = (industry || '').toLowerCase().trim();
    console.log(`Using normalized industry: '${normalizedIndustry}'`);
    
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
        includeCriteriaDescriptions: false,
        maxActions: 5,
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
          includeCriteriaDescriptions: false,
          maxActions: 5,
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
    
    // First check if we have a custom prompt in the company_urls.csv file
    // Second check if we have a specialized prompt for this industry
    // Finally fall back to standard prompts
    
    const industrySpecificPrompt = await industryPrompts.getIndustryPrompt(normalizedIndustry, url);
    
    // Determine which prompt to use, in order of priority: custom > industry-specific > standard
    let apiRequest;
    
    if (customPrompt && customPrompt.trim()) {
      console.log(`Using custom prompt from company_urls.csv file for ${companyId}`);
      // Adjust the PDF URL reference if present in the custom prompt
      let adjustedCustomPrompt = customPrompt;
      if (adjustedCustomPrompt.includes('The PDF is attached.')) {
        adjustedCustomPrompt = adjustedCustomPrompt.replace('The PDF is attached.', `The PDF URL is: ${url}`);
      }
      
      apiRequest = {
        model: config.claudeModel,
        max_tokens: 8000,
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
    } else if (industrySpecificPrompt) {
      console.log(`Using specialized prompt for ${normalizedIndustry} industry`);
      // Use the industry-specific prompt directly
      apiRequest = {
        model: config.claudeModel,
        max_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: industrySpecificPrompt
              }
            ]
          }
        ],
        temperature: 0.2
      };
    } else {
      // Use the standard system + user prompt approach
      console.log(`Using standard prompts for ${normalizedIndustry} industry`);
      apiRequest = {
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
    
    // Send the request to Claude with URL in the prompt, with retry logic
    const response = await retryWithBackoff(async () => {
      return await anthropic.messages.create(apiRequest);
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
    
    // Check if this is an industry-specific prompt or custom prompt with XML structure
    if (industrySpecificPrompt || (customPrompt && customPrompt.includes('<sustainability_analysis>'))) {
      console.log(`Attempting to extract XML structure for ${companyId} using industry-specific format...`);
      try {
        // Extract data from XML sustainability_analysis tags
        const xmlMatch = responseText.match(/<sustainability_analysis>[\s\S]*?<\/sustainability_analysis>/g);
        
        // Initialize xmlContent variable to hold the XML data
        let xmlContent;
        
        // If we don't find the expected tag structure, search more broadly
        if (!xmlMatch || xmlMatch.length === 0) {
          console.log(`Could not find <sustainability_analysis> tags in response for ${companyId}, searching for individual tags...`);
          
          // Try to extract individual tags instead
          const extractTag = (tagName) => {
            const regex = new RegExp(`<${tagName}>(.*?)<\/${tagName}>`, 's');
            const match = responseText.match(regex);
            return match ? match[1].trim() : '';
          };
          
          // Create a synthetic XML content from individual tags
          xmlContent = `<sustainability_analysis>
            <file_name>${extractTag('file_name')}</file_name>
            <company>${extractTag('company')}</company>
            <abstract>${extractTag('abstract')}</abstract>
            <highlight_courage>${extractTag('highlight_courage')}</highlight_courage>
            <highlight_action>${extractTag('highlight_action')}</highlight_action>
            <highlight_solution>${extractTag('highlight_solution')}</highlight_solution>
            <criteria1_actions_solutions>${extractTag('criteria1_actions_solutions')}</criteria1_actions_solutions>
            <criteria2_actions_solutions>${extractTag('criteria2_actions_solutions')}</criteria2_actions_solutions>
            <criteria3_actions_solutions>${extractTag('criteria3_actions_solutions')}</criteria3_actions_solutions>
            <criteria4_actions_solutions>${extractTag('criteria4_actions_solutions')}</criteria4_actions_solutions>
            <criteria5_actions_solutions>${extractTag('criteria5_actions_solutions')}</criteria5_actions_solutions>
            <criteria6_actions_solutions>${extractTag('criteria6_actions_solutions')}</criteria6_actions_solutions>
            <criteria7_actions_solutions>${extractTag('criteria7_actions_solutions')}</criteria7_actions_solutions>
          </sustainability_analysis>`;
          
          console.log(`Created synthetic XML content for ${companyId}`);
        } else {
          xmlContent = xmlMatch[0];
          console.log(`Found XML content for ${companyId}`);
        }
        
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
        const companyName = extractXMLValue('company') || name || companyId;
        
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
          /* For construction industry, we map the criteria as follows:
            criteria1 = buildings (sustainable construction)
            criteria2 = energy_efficiency
            criteria3 = renewable_energies
            criteria4 = climate_neutral_operation
            criteria5 = materials (sustainable materials)
            criteria6 = occupational_safety_and_health
            criteria7 = carbon_footprint
          */
          // Map the criteria fields to our expected structure - these fields match esg-criteria.js
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
          }
        };

        // Add carbon footprint data with default empty strings
        mappedData.carbonFootprint = {
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
        };

        // Add climate standards with default values
        mappedData.climateStandards = {
          iso14001: extractXMLValue('climate_standard_iso_14001') || 'No',
          iso50001: extractXMLValue('climate_standard_iso_50001') || 'No',
          emas: extractXMLValue('climate_standard_emas') || 'No',
          cdp: extractXMLValue('climate_standard_cdp') || 'No',
          sbti: extractXMLValue('climate_standard_sbti') || 'No'
        };

        // Add other info and controversies with defaults
        mappedData.otherInitiatives = extractXMLValue('other') || '';
        mappedData.controversies = extractXMLValue('controversies') || '';
        
        // Add company details with defaults to avoid null values
        mappedData.companyDetails = {
          legalEntityName: extractXMLValue('company') || companyName,
          businessDescription: '',
          sector: 'Construction',
          address: {
            street: '',
            zipCode: '',
            city: '',
            country: ''
          },
          contactInfo: {
            phoneNumber: '',
            emailAddress: '',
            website: url || ''
          },
          foundingYear: '',
          employeeRange: '',
          revenueRange: ''
        };
        
        extractedJson = mappedData;
        parseSuccess = true;
        console.log(`Successfully extracted XML data for ${companyId} with industry-specific format`);
        
        // Make sure to save the raw response for direct access later
        result.rawResponse = responseText;
      } catch (xmlError) {
        console.error(`Error parsing XML: ${xmlError.message}`);
        parseErrors.push(`XML parsing: ${xmlError.message}`);
      }
    }
    
    // Strategy 1: Simple JSON.parse if it's already valid JSON and not already parsed via XML
    try {
      // Skip if we already parsed via XML
      if (!parseSuccess) {
        const trimmedResponse = responseText.trim();
        if (trimmedResponse.startsWith('{') && trimmedResponse.endsWith('}')) {
          extractedJson = JSON.parse(trimmedResponse);
          parseSuccess = true;
          console.log(`Successfully parsed JSON directly for ${companyId}`);
        }
      }
    } catch (parseError) {
      parseErrors.push(`Direct JSON parsing: ${parseError.message}`);
      console.log(`Direct JSON parsing failed: ${parseError.message}`);
    }
    
    // Strategy 2: Try to extract JSON from markdown code blocks (more aggressive matching)
    if (!parseSuccess && !industrySpecificPrompt) {
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
    if (!parseSuccess && !industrySpecificPrompt) {
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
    if (!parseSuccess && !industrySpecificPrompt) {
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
      
      // If there are any missing criteria, add empty placeholders
      relevantCriteria.forEach(criterion => {
        if (!extractedData[criterion.id]) {
          extractedData[criterion.id] = {
            actions: ["# No specific actions found for " + criterion.name_en],
            extracts: "No relevant information found in the report for " + criterion.name_en
          };
        }
      });
      
      // For construction industry, always set the industry and sourceType
          extractedData.industry = normalizedIndustry;
          extractedData.sourceType = urlType;
          
          // Log successful extraction with debug information
          console.log(`Successfully extracted ESG data for ${companyId} using industry-specific XML format`);
          console.log(`Fields found: ${Object.keys(extractedData).join(', ')}`);
      
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
        rawResponse: responseText,  // Always include the raw response
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