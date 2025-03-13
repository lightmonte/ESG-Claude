/**
 * solution-ranker.js
 * 
 * This module handles ranking solutions extracted by Claude and filtering to top N.
 */

import Anthropic from '@anthropic-ai/sdk';
import config from './config.js';
import { logToFile, sleep, ensureDirectoryExists } from './utils.js';
import tokenTracker from './lib/token-tracker.js';
import errorHandler from './lib/error-handler.js';
import fs from 'fs/promises';
import path from 'path';

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
 * Rank solutions for a company by importance
 * @param {Object} companyData - Extracted company data with all solutions
 * @returns {Promise<Object>} - Company data with ranked solutions
 */
export async function rankSolutions(companyData) {
  const { companyId, extractedData } = companyData;
  
  try {
    console.log(`Ranking solutions for ${companyId}...`);
    
    // Create a prompt for Claude to rank the solutions
    const prompt = createRankingPrompt(extractedData);
    
    // Send the request to Claude with retry logic
    const response = await retryWithBackoff(async () => {
      return await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 4000,
        system: "You are an expert in ESG initiatives who specializes in ranking company sustainability solutions by their importance and impact. Your task is to analyze a list of ESG solutions and rank them from most to least important based on their environmental/social impact, innovation, scale, and alignment with industry best practices.",
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        temperature: 0.2
      });
    });
    
    // Record token usage - reuse the existing extraction usage tracking
    tokenTracker.recordClaudeExtractionUsage(`${companyId}_ranking`, response);
    
    // Process Claude's response
    const responseText = response.content[0].text;
    
    // Save raw ranking response for debugging
    const debugDir = path.join(config.outputDir, 'raw_responses');
    await ensureDirectoryExists(debugDir);
    await fs.writeFile(
      path.join(debugDir, `${companyId}_ranking_response.txt`),
      responseText
    );
    
    // Try to extract JSON
    let rankedData;
    try {
      // Extract JSON using the same strategies as in claude-extractor.js
      let parseSuccess = false;
      
      // Strategy 1: Simple JSON.parse if it's already valid JSON
      if (responseText.trim().startsWith('{') && responseText.trim().endsWith('}')) {
        rankedData = JSON.parse(responseText.trim());
        parseSuccess = true;
      }
      
      // Strategy 2: Try to extract JSON from markdown code blocks
      if (!parseSuccess) {
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          rankedData = JSON.parse(jsonMatch[1].trim());
          parseSuccess = true;
        }
      }
      
      // Strategy 3: Try to extract anything that looks like a JSON object
      if (!parseSuccess) {
        const potentialJson = responseText.match(/{[\s\S]*}/);
        if (potentialJson && potentialJson[0]) {
          rankedData = JSON.parse(potentialJson[0]);
          parseSuccess = true;
        }
      }
      
      // Use the shared parser as a fallback
      if (!parseSuccess) {
        const parseResult = errorHandler.parseJSON(responseText);
        if (parseResult.success) {
          rankedData = parseResult.data;
          parseSuccess = true;
        } else {
          throw new Error("Failed to parse ranking response as JSON");
        }
      }
      
      if (parseSuccess) {
        console.log(`Successfully ranked solutions for ${companyId}`);
        
        // Save ranked data for reference
        const rankedDir = path.join(config.outputDir, 'ranked');
        await ensureDirectoryExists(rankedDir);
        await fs.writeFile(
          path.join(rankedDir, `${companyId}_ranked.json`),
          JSON.stringify(rankedData, null, 2)
        );
        
        return {
          ...companyData,
          extractedData: rankedData,
          status: 'ranking_complete'
        };
      } else {
        throw new Error("Failed to parse ranking response as JSON");
      }
    } catch (error) {
      throw new Error(`Failed to parse ranking response: ${error.message}`);
    }
  } catch (error) {
    console.error(`Error ranking solutions for ${companyId}: ${error.message}`);
    await logToFile(`Error ranking solutions for ${companyId}: ${error.message}`);
    
    return {
      ...companyData,
      error: error.message,
      status: 'ranking_failed'
    };
  }
}

/**
 * Create a prompt for ranking solutions
 * @param {Object} extractedData - Extracted company data
 * @returns {string} - Prompt for Claude
 */
function createRankingPrompt(extractedData) {
  // Get all criteria IDs except basicInformation and industry
  const criteriaIds = Object.keys(extractedData).filter(
    id => id !== 'basicInformation' && id !== 'industry'
  );
  
  return `I need you to rank the ESG solutions for each criterion by importance and impact.

Review the following ESG data extracted from a company's sustainability report. For each criterion:
1. Analyze all the actions/solutions listed
2. Rank them from most to least important based on environmental/social impact, innovation, scale, and alignment with industry best practices
3. Return the same data structure but with actions ranked by importance (most important first)

Company ESG Data:
\`\`\`json
${JSON.stringify(extractedData, null, 2)}
\`\`\`

REQUIREMENTS:
1. Maintain the exact same JSON structure
2. Do not add or remove any criteria
3. Keep all the same actions, just re-order them by importance
4. Return only the ranked JSON data structure, with no additional explanations

Your response should be valid JSON that can be parsed with JSON.parse().`;
}

/**
 * Filter ranked solutions to keep only the top N
 * @param {Object} companyData - Company data with ranked solutions
 * @param {number} topN - Number of top solutions to keep (default: 5)
 * @returns {Object} - Company data with filtered solutions
 */
export function filterTopSolutions(companyData, topN = 5) {
  const { companyId, extractedData } = companyData;
  
  console.log(`Filtering to top ${topN} solutions for ${companyId}...`);
  
  // Get all criteria IDs except basicInformation and industry
  const criteriaIds = Object.keys(extractedData).filter(
    id => id !== 'basicInformation' && id !== 'industry'
  );
  
  // Create a new object with filtered solutions
  const filteredData = {
    ...extractedData
  };
  
  // Filter each criterion to keep only top N actions
  criteriaIds.forEach(criterionId => {
    const criterion = extractedData[criterionId];
    
    // Skip if no actions property or it's not an array
    if (!criterion || !criterion.actions || !Array.isArray(criterion.actions)) {
      return;
    }
    
    // If there are more than topN actions, filter to top N
    if (criterion.actions.length > topN) {
      filteredData[criterionId] = {
        ...criterion,
        actions: criterion.actions.slice(0, topN)
      };
      
      console.log(`Filtered ${criterionId} from ${criterion.actions.length} to ${topN} actions`);
    }
  });
  
  return {
    ...companyData,
    extractedData: filteredData,
    status: 'filtering_complete'
  };
}

export default {
  rankSolutions,
  filterTopSolutions
};