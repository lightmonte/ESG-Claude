/**
 * website-extractor.js
 * 
 * This module extracts text content from websites.
 * It fetches and processes HTML to extract readable content for ESG analysis.
 */

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { logToFile } from '../../utils.js';

/**
 * Extract readable text content from a website URL
 * @param {string} url - The website URL to extract content from
 * @returns {Promise<Object>} - Object containing extracted title, content, and metadata
 */
export async function extractWebsiteContent(url) {
  try {
    console.log(`Fetching website content from: ${url}`);
    
    // Set appropriate headers to mimic a browser
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    };
    
    // Fetch the website content
    const response = await axios.get(url, { 
      headers,
      timeout: 30000, // 30 second timeout
      maxContentLength: 10 * 1024 * 1024 // 10 MB limit to prevent huge pages
    });
    
    // Create a DOM from the HTML
    const dom = new JSDOM(response.data, { url });
    
    // Use Readability to extract the main content
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (!article) {
      throw new Error('Failed to parse article content from website');
    }
    
    console.log(`Successfully extracted content from ${url}: ${article.title}`);
    console.log(`Extracted ${article.textContent.length} characters of text`);
    
    // Extract metadata from the page
    const metadata = {
      title: article.title,
      siteName: article.siteName || '',
      excerpt: article.excerpt || '',
      length: article.textContent.length,
      url: url
    };
    
    // Look for any sustainability-related headers or sections
    const sustainabilityKeywords = [
      'sustainability', 'sustainable', 'esg', 'environment', 'environmental',
      'social responsibility', 'governance', 'carbon', 'emissions', 'climate',
      'green', 'renewable', 'energy', 'waste', 'water', 'diversity', 'inclusion'
    ];
    
    // Get all headings from the document
    const headings = [...dom.window.document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map(heading => heading.textContent.trim())
      .filter(text => text && sustainabilityKeywords.some(keyword => 
        text.toLowerCase().includes(keyword)
      ));
    
    if (headings.length > 0) {
      metadata.sustainabilityHeadings = headings;
      console.log(`Found ${headings.length} sustainability-related headings`);
    }
    
    return {
      title: article.title,
      content: article.textContent,
      html: article.content,
      metadata
    };
  } catch (error) {
    console.error(`Error extracting content from ${url}: ${error.message}`);
    throw new Error(`Failed to extract content from website: ${error.message}`);
  }
}

/**
 * Format extracted website content for Claude input
 * @param {Object} extractedContent - Content extracted from website
 * @returns {string} - Formatted text for Claude input
 */
export function formatWebsiteContentForClaude(extractedContent) {
  const { title, content, metadata } = extractedContent;
  
  // Create a structured text representation for Claude
  let formattedContent = `WEBSITE CONTENT EXTRACTION\n\n`;
  formattedContent += `TITLE: ${title}\n`;
  formattedContent += `URL: ${metadata.url}\n`;
  
  if (metadata.siteName) {
    formattedContent += `SITE: ${metadata.siteName}\n`;
  }
  
  if (metadata.sustainabilityHeadings && metadata.sustainabilityHeadings.length > 0) {
    formattedContent += `\nSUSTAINABILITY-RELATED SECTIONS:\n`;
    formattedContent += metadata.sustainabilityHeadings.map(h => `- ${h}`).join('\n');
    formattedContent += `\n`;
  }
  
  formattedContent += `\n--- CONTENT START ---\n\n`;
  formattedContent += content.trim();
  formattedContent += `\n\n--- CONTENT END ---\n`;
  
  return formattedContent;
}

export default {
  extractWebsiteContent,
  formatWebsiteContentForClaude
};