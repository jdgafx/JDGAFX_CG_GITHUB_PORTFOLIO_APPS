import type { BotStep } from '../types'

/**
 * A canned scenario used only when the user explicitly asks for it. It is never presented as
 * the result of the user's own task — see the sample labelling in App.tsx.
 */
export const SAMPLE_TASK = 'Find cheapest flight NYC to LA next Friday'

export const SAMPLE_STEPS: BotStep[] = [
  {
    action: 'navigate',
    target: 'google.com/flights',
    thought: 'Opening Google Flights to search for available routes...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'find',
    target: 'origin input field',
    thought: 'Locating the departure city input field on the page...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'click',
    target: 'origin input',
    thought: 'Clicking the origin field to start entering departure city...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'type',
    target: 'origin input',
    value: 'New York (JFK)',
    thought: 'Typing the departure airport code and city name...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'find',
    target: 'destination input',
    thought: 'Now searching for the destination field to enter arrival city...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'type',
    target: 'destination input',
    value: 'Los Angeles (LAX)',
    thought: 'Entering the destination airport — LAX for Los Angeles...',
    url: 'https://google.com/flights',
    pageContent: 'flights-search',
  },
  {
    action: 'click',
    target: 'Search button',
    thought: 'Submitting the search to find available flights...',
    url: 'https://google.com/flights/results',
    pageContent: 'flights-results',
  },
  {
    action: 'extract',
    target: 'flight prices list',
    value: '1. Spirit Airlines — $189, 6:15 AM, Nonstop\n2. United Airlines — $234, 8:30 AM, Nonstop\n3. Delta Air Lines — $267, 11:45 AM, Nonstop\n4. American Airlines — $312, 2:20 PM, Nonstop',
    thought: 'Found 47 results. Extracting price data from the cheapest options...',
    url: 'https://google.com/flights/results',
    pageContent: 'flights-results',
  },
  {
    action: 'verify',
    target: 'cheapest flight',
    value: 'Cheapest: Spirit Airlines $189, departing 6:15 AM JFK→LAX, Nonstop, 5h 45m',
    thought: 'Verified! Cheapest flight is $189 on Spirit Airlines at 6:15 AM.',
    url: 'https://google.com/flights/results',
    pageContent: 'flights-results',
  },
]
