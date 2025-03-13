/**
 * system-prompt.js
 *
 * This module provides system prompts for Claude API interactions.
 */

/**
 * Create a system prompt for ESG extraction
 * @param {string} industry - Industry of the company
 * @param {boolean} isBatch - Whether this is a batch request
 * @returns {string} - System prompt
 */
export function createSystemPrompt(industry, isBatch = false) {
  const normalizedIndustry = industry || 'general';
  
  return `You are an expert ESG data extraction assistant specializing in corporate sustainability reports for the ${normalizedIndustry} industry.
Your task is to analyze PDF reports and extract structured ESG data according to specific criteria.
Focus on extracting factual, specific information directly stated in the document.
Format your response as a single, valid JSON object with the exact structure matching the criteria IDs. Do not include backticks, markdown formatting, or any text before or after the JSON.
''}`;
}

export default {
  createSystemPrompt
};