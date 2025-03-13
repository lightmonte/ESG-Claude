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
  try {
    // First try direct parsing
    return { 
      data: JSON.parse(responseText),
      success: true
    };
  } catch (initialError) {
    console.log('Initial JSON parse failed, trying alternative parsing strategies');
    
    try {
      // Strategy 1: Look for JSON in code blocks
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        const jsonText = codeBlockMatch[1];
        return { 
          data: JSON.parse(jsonText),
          success: true,
          strategy: 'code_block'
        };
      }
      
      // Strategy 2: Look for JSON with curly braces
      const bracesMatch = responseText.match(/(\{[\s\S]*\})/);
      if (bracesMatch && bracesMatch[1]) {
        const jsonText = bracesMatch[1];
        return { 
          data: JSON.parse(jsonText),
          success: true,
          strategy: 'braces'
        };
      }
      
      // Strategy 3: Find the largest JSON-like block
      const potentialBlocks = responseText.match(/\{[^{}]*(\{[^{}]*\})*[^{}]*\}/g) || [];
      if (potentialBlocks.length > 0) {
        // Use the largest block
        const jsonText = potentialBlocks.reduce((a, b) => a.length > b.length ? a : b);
        
        // Clean up the JSON to handle common issues
        const cleanedJson = cleanJSONText(jsonText);
        
        return { 
          data: JSON.parse(cleanedJson),
          success: true,
          strategy: 'largest_block'
        };
      }
      
      // All strategies failed
      throw new Error('No JSON pattern found in the response');
    } catch (strategyError) {
      return {
        success: false, 
        error: strategyError,
        message: strategyError.message,
        initialError: initialError.message,
        originalText: responseText.substring(0, 500) + '...' // Include start of text for debugging
      };
    }
  }
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

export default {
  isRetryableError,
  formatErrorMessage,
  handleError,
  parseJSON
};