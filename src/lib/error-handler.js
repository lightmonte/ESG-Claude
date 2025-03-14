/**
 * error-handler.js
 * 
 * Centralized error handling for the esg-Claude application.
 * Provides consistent error handling patterns across all modules.
 */

import { logToFile } from '../utils.js';

/**
 * Handle API errors with retry logic
 * @param {Error} error - The error object
 * @param {number} retryCount - Current retry count
 * @param {number} maxRetries - Maximum number of retries
 * @returns {boolean} - Whether the error is retryable
 */
export function isRetryableError(error, retryCount = 0, maxRetries = 3) {
  // Check if we've exceeded max retries
  if (retryCount >= maxRetries) {
    return false;
  }
  
  // Check for specific retryable error types
  const isOverloadedError = 
    error.error?.type === 'overloaded_error' || 
    error.message?.includes('429') ||
    error.message?.includes('overloaded') ||
    error.message?.includes('rate limit');
    
  return isOverloadedError;
}

/**
 * Format error message for consistent logging and reporting
 * @param {string} context - Context where the error occurred (e.g., 'extraction', 'batch processing')
 * @param {Error} error - The error object
 * @param {string} entityId - ID of the entity being processed (e.g., companyId, batchId)
 * @returns {string} - Formatted error message
 */
export function formatErrorMessage(context, error, entityId = '') {
  const errorMessage = error.message || 'Unknown error';
  const errorType = error.error?.type || error.name || 'Error';
  const entityPrefix = entityId ? `[${entityId}] ` : '';
  
  return `${entityPrefix}${context} error (${errorType}): ${errorMessage}`;
}

/**
 * Centralized error handler for consistent logging and reporting
 * @param {string} context - Context where the error occurred
 * @param {Error} error - The error object 
 * @param {string} entityId - ID of the entity being processed
 * @param {string} logfile - Optional log file to write to
 */
export async function handleError(context, error, entityId = '', logfile = null) {
  const formattedMessage = formatErrorMessage(context, error, entityId);
  
  // Log to console
  console.error(formattedMessage);
  
  // Log to file if specified
  if (logfile) {
    await logToFile(formattedMessage, logfile);
  }
  
  // Add specialized handling for specific error types
  if (error.error?.type === 'authentication_error') {
    console.error('API Authentication error: Please check your Claude API key in the .env file');
  } else if (error.error?.type === 'overloaded_error' || error.message?.includes('429')) {
    console.error('Claude API is currently overloaded or rate limited. You might want to reduce concurrent requests or try again later.');
  }
}

/**
 * JSON parsing handler with multiple fallback strategies
 * @param {string} responseText - Text to parse as JSON
 * @returns {Object} - Parsed JSON object or error with context
 */
export function parseJSON(responseText) {
  if (!responseText || typeof responseText !== 'string' || responseText.trim().length === 0) {
    return {
      success: false,
      message: 'Empty or invalid response text',
      originalText: (responseText || '').substring(0, 100) + '...'
    };
  }

  try {
    // First try direct parsing if it looks like complete JSON
    const trimmedResponse = responseText.trim();
    if (trimmedResponse.startsWith('{') && trimmedResponse.endsWith('}')) {
      try {
        return { 
          data: JSON.parse(trimmedResponse),
          success: true,
          strategy: 'direct_parse'
        };
      } catch (directError) {
        console.log(`Direct parsing failed: ${directError.message}`);
        // Continue to other strategies
      }
    }
    
    console.log('Trying advanced JSON parsing strategies');
    
    // Strategy 1: Look for JSON in code blocks (multiple blocks support)
    const codeBlocks = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/g) || [];
    for (const block of codeBlocks) {
      try {
        const jsonText = block.replace(/```(?:json)?\s*/, '').replace(/\s*```$/, '');
        if (jsonText.trim().startsWith('{') && jsonText.trim().endsWith('}')) {
          return { 
            data: JSON.parse(jsonText.trim()),
            success: true,
            strategy: 'code_block'
          };
        }
      } catch (blockError) {
        console.log(`Code block parsing failed, trying next block: ${blockError.message}`);
        // Continue to next block or strategy
      }
    }
    
    // Strategy 2: Find balanced JSON objects
    try {
      const jsonObjects = findBalancedJSONObjects(responseText);
      for (const obj of jsonObjects) {
        if (obj.length > 50) { // Only consider substantial objects
          try {
            return { 
              data: JSON.parse(obj),
              success: true,
              strategy: 'balanced_json'
            };
          } catch (objError) {
            // Try next object
          }
        }
      }
    } catch (balancedError) {
      console.log(`Balanced JSON search failed: ${balancedError.message}`);
    }
    
    // Strategy 3: Look for JSON with simple regex (less accurate but might catch some cases)
    const bracesMatch = responseText.match(/(\{[\s\S]*?\})(?=\s*$|\s*[^\{\}])/);
    if (bracesMatch && bracesMatch[1]) {
      try {
        const jsonText = bracesMatch[1];
        if (jsonText.length > 50) { // Only consider substantial objects
          return { 
            data: JSON.parse(jsonText),
            success: true,
            strategy: 'regex_braces'
          };
        }
      } catch (bracesError) {
        console.log(`Braces regex parsing failed: ${bracesError.message}`);
      }
    }
    
    // Strategy 4: Find the largest JSON-like block with cleanup
    const potentialBlocks = responseText.match(/\{[^{}]*(\{[^{}]*\})*[^{}]*\}/g) || [];
    if (potentialBlocks.length > 0) {
      // Sort blocks by length (largest first)
      potentialBlocks.sort((a, b) => b.length - a.length);
      
      // Try each block, starting with the largest
      for (const block of potentialBlocks) {
        if (block.length > 50) { // Only consider substantial objects
          try {
            // Clean up the JSON to handle common issues
            const cleanedJson = cleanJSONText(block);
            return { 
              data: JSON.parse(cleanedJson),
              success: true,
              strategy: 'cleaned_json_block'
            };
          } catch (blockError) {
            // Try next block
          }
        }
      }
    }
    
    // Strategy 5: Extreme recovery - try to build a valid JSON
    try {
      const recoveredJSON = repairBrokenJSON(responseText);
      if (recoveredJSON) {
        return {
          data: recoveredJSON,
          success: true,
          strategy: 'repaired_json',
          warning: 'JSON was repaired and might be incomplete or contain errors'
        };
      }
    } catch (repairError) {
      console.log(`JSON repair failed: ${repairError.message}`);
    }
    
    // All strategies failed
    throw new Error('No valid JSON pattern found in the response after trying all strategies');
  } catch (mainError) {
    return {
      success: false, 
      error: mainError,
      message: mainError.message,
      originalText: responseText.substring(0, 500) + '...' // Include start of text for debugging
    };
  }
}

/**
 * Find balanced JSON objects in text
 * @param {string} text - Text to search for JSON objects
 * @returns {string[]} - Array of potential JSON objects
 */
function findBalancedJSONObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.substring(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        // Handle imbalanced braces by resetting
        depth = 0;
        start = -1;
      }
    }
  }
  
  return objects;
}

/**
 * Clean JSON text to handle common issues
 * @param {string} jsonText - JSON text to clean
 * @returns {string} - Cleaned JSON text
 */
function cleanJSONText(jsonText) {
  return jsonText
    // Handle common escape sequences
    .replace(/\\n/g, '\\n')
    .replace(/\\'/g, "\\'")
    .replace(/\\"/g, '\\"')
    .replace(/\\&/g, '\\&')
    .replace(/\\r/g, '\\r')
    .replace(/\\t/g, '\\t')
    .replace(/\\b/g, '\\b')
    .replace(/\\f/g, '\\f')
    // Remove non-printable characters
    .replace(/[\u0000-\u0019]+/g, '')
    // Normalize whitespace
    .replace(/\s*[\n\r]+\s*/g, ' ')
    // Remove trailing commas
    .replace(/,\s*([}\]])/g, '$1');
}

/**
 * Attempt to repair broken JSON using heuristics
 * @param {string} text - Text containing broken JSON
 * @returns {Object|null} - Repaired JSON object or null if unable to repair
 */
function repairBrokenJSON(text) {
  // First check if we can extract any json-like structure
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  
  let jsonText = jsonMatch[0];
  
  // Apply aggressive cleanup
  jsonText = jsonText
    // Remove any markdown markers
    .replace(/```json|```/g, '')
    // Fix unescaped quotes in strings
    .replace(/(["']:)(.*?)(["'])/g, (match, start, content, end) => {
      if (start[0] === end[0]) {
        return match; // Already properly quoted
      }
      // Fix mismatched quotes
      return `${start[0]}:${content}${start[0]}`;
    })
    // Fix missing quotes around property names
    .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":')
    // Remove trailing commas in objects and arrays
    .replace(/,\s*([}\]])/g, '$1')
    // Add missing commas between properties
    .replace(/"\s*}\s*"/g, '","')
    // Clean whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // If we still can't parse, try one more approach - manually building an object
    try {
      // Extract all property:value pairs we can find
      const propertyMatches = jsonText.match(/"([^"]+)"\s*:\s*([^,}]+)/g);
      if (!propertyMatches) return null;
      
      const manualObject = {};
      for (const prop of propertyMatches) {
        const parts = prop.split(':').map(p => p.trim());
        if (parts.length === 2) {
          let key = parts[0].replace(/"/g, '');
          let value = parts[1];
          
          // Try to parse the value
          try {
            value = JSON.parse(value);
          } catch {
            // If we can't parse it, keep it as a string
            value = value.replace(/"/g, '').trim();
          }
          
          manualObject[key] = value;
        }
      }
      
      return Object.keys(manualObject).length > 0 ? manualObject : null;
    } catch (manualError) {
      console.log(`Manual object building failed: ${manualError.message}`);
      return null;
    }
  }
}

export default {
  isRetryableError,
  formatErrorMessage,
  handleError,
  parseJSON
};