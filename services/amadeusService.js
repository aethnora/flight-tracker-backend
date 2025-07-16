const fetch = require('node-fetch');

const AMADEUS_API_BASE_URL = 'https://test.api.amadeus.com';
let amadeusAccessToken = {
    token: null,
    expiresAt: 0,
};

const getAccessToken = async () => {
    // ... (existing getAccessToken logic remains unchanged) ...
    const now = Date.now();
    if (amadeusAccessToken.token && now < amadeusAccessToken.expiresAt) {
        return amadeusAccessToken.token;
    }
    const { AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET } = process.env;
    if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
        throw new Error('Amadeus API credentials are not set in environment variables.');
    }
    const authUrl = `${AMADEUS_API_BASE_URL}/v1/security/oauth2/token`;
    const body = `grant_type=client_credentials&client_id=${AMADEUS_CLIENT_ID}&client_secret=${AMADEUS_CLIENT_SECRET}`;
    try {
        const response = await fetch(authUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body,
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to get Amadeus token: ${response.statusText} - ${JSON.stringify(errorData)}`);
        }
        const data = await response.json();
        amadeusAccessToken = {
            token: data.access_token,
            expiresAt: now + (data.expires_in * 1000) - 10000,
        };
        return amadeusAccessToken.token;
    } catch (error) {
        console.error('Error fetching Amadeus access token:', error);
        throw error;
    }
};


/**
 * Fetches the lowest current price for a flight, supporting trip type and fare class.
 * @param {object} flightDetails - The details of the flight to check.
 * @param {string} flightDetails.travelClass - The Amadeus travel class code (e.g., 'ECONOMY', 'BUSINESS').
 */
const getFlightPrice = async (flightDetails) => {
    // <<< MODIFIED: Destructure travelClass from flightDetails >>>
    const { departureAirport, arrivalAirport, departureDate, returnDate, airline, travelClass } = flightDetails;

    try {
        const accessToken = await getAccessToken();
        
        // --- Build the search URL with new parameters ---
        let searchUrl = `${AMADEUS_API_BASE_URL}/v2/shopping/flight-offers` +
            `?originLocationCode=${departureAirport}` +
            `&destinationLocationCode=${arrivalAirport}` +
            `&departureDate=${departureDate}` +
            `&adults=1` +
            `&currencyCode=USD` +
            `&max=1`;

        if (airline) {
            searchUrl += `&includeAirlineCodes=${airline}`;
        }
        
        // <<< NEW: Add travelClass to the API request if it exists >>>
        if (travelClass) {
            searchUrl += `&travelClass=${travelClass}`;
            console.log(`Searching with fare class: ${travelClass}`);
        }

        // Add returnDate for round-trip searches
        if (returnDate) {
            searchUrl += `&returnDate=${returnDate}`;
            console.log(`Performing ROUND-TRIP search for ${departureAirport} -> ${arrivalAirport}`);
        } else {
            console.log(`Performing ONE-WAY search for ${departureAirport} -> ${arrivalAirport}`);
        }
        
        const response = await fetch(searchUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            if (response.status === 400) {
                console.warn(`No flight offers found for the specified criteria.`);
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
            console.log(`No flight offers returned for the specified criteria.`);
            return null;
        }

    } catch (error) {
        console.error(`Error in getFlightPrice for ${departureAirport}-${arrivalAirport}:`, error);
        return null;
    }
};

module.exports = {
    getFlightPrice,
};
