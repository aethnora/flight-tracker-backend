const fetch = require('node-fetch'); // Use node-fetch for making HTTP requests in Node.js

const AMADEUS_API_BASE_URL = 'https://test.api.amadeus.com'; // Use https://api.amadeus.com for production

// Store the access token in memory to reuse it until it expires.
// In a multi-server environment, this should be stored in a shared cache like Redis.
let amadeusAccessToken = {
    token: null,
    expiresAt: 0,
};

/**
 * Gets a valid Amadeus API access token, refreshing it if necessary.
 * This handles the OAuth 2.0 authentication flow.
 * @returns {Promise<string>} A valid access token.
 */
const getAccessToken = async () => {
    const now = Date.now();

    // If we have a valid token that hasn't expired, reuse it.
    if (amadeusAccessToken.token && now < amadeusAccessToken.expiresAt) {
        console.log('Reusing existing Amadeus access token.');
        return amadeusAccessToken.token;
    }

    console.log('Amadeus token is expired or missing. Fetching a new one...');
    const { AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET } = process.env;

    if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
        throw new Error('Amadeus API credentials are not set in environment variables.');
    }

    const authUrl = `${AMADEUS_API_BASE_URL}/v1/security/oauth2/token`;
    const body = `grant_type=client_credentials&client_id=${AMADEUS_CLIENT_ID}&client_secret=${AMADEUS_CLIENT_SECRET}`;

    try {
        const response = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to get Amadeus token: ${response.statusText} - ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        
        // Store the new token and calculate its expiration time (with a 10-second buffer)
        amadeusAccessToken = {
            token: data.access_token,
            expiresAt: now + (data.expires_in * 1000) - 10000,
        };

        console.log('Successfully fetched new Amadeus access token.');
        return amadeusAccessToken.token;

    } catch (error) {
        console.error('Error fetching Amadeus access token:', error);
        throw error; // Rethrow the error to be handled by the calling function
    }
};

/**
 * Fetches the lowest current price for a one-way flight.
 * This uses the Amadeus Flight Offers Price API, which is cost-effective.
 * @param {object} flightDetails - The details of the flight to check.
 * @param {string} flightDetails.departureAirport - IATA code (e.g., "JFK").
 * @param {string} flightDetails.arrivalAirport - IATA code (e.g., "LAX").
 * @param {string} flightDetails.departureDate - YYYY-MM-DD format.
 * @param {string} flightDetails.airline - IATA code for the airline (e.g., "AA").
 * @returns {Promise<object|null>} An object with price details or null if not found.
 */
const getFlightPrice = async (flightDetails) => {
    const { departureAirport, arrivalAirport, departureDate, airline } = flightDetails;

    try {
        const accessToken = await getAccessToken();
        const searchUrl = `${AMADEUS_API_BASE_URL}/v2/shopping/flight-offers?originLocationCode=${departureAirport}&destinationLocationCode=${arrivalAirport}&departureDate=${departureDate}&adults=1&nonStop=true&currencyCode=USD&max=1&includeAirlineCodes=${airline}`;

        const response = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            // If the flight is not found (400) or other client error, it's not a server failure.
            if (response.status === 400) {
                console.warn(`No flight offers found for ${departureAirport}-${arrivalAirport} on ${departureDate}.`);
                return null;
            }
            const errorData = await response.json();
            throw new Error(`Amadeus flight search failed: ${response.statusText} - ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            const flightOffer = data.data[0];
            return {
                currentPrice: parseFloat(flightOffer.price.total),
                currency: flightOffer.price.currency,
                lastChecked: new Date().toISOString(),
            };
        } else {
            console.log(`No flight offers returned for ${departureAirport}-${arrivalAirport} on ${departureDate}.`);
            return null;
        }

    } catch (error) {
        console.error(`Error in getFlightPrice for ${departureAirport}-${arrivalAirport}:`, error);
        return null; // Return null to indicate the price check failed but the system shouldn't crash
    }
};

module.exports = {
    getFlightPrice,
};
