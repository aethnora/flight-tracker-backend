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
 * Fetches the lowest current price for a flight. If a departureTime is provided,
 * it finds the flight offer closest to that time.
 * @param {object} flightDetails - The details of the flight to check.
 */
const getFlightPrice = async (flightDetails) => {
    const { departureAirport, arrivalAirport, departureDate, returnDate, airline, travelClass, departureTime } = flightDetails;

    try {
        const accessToken = await getAccessToken();
        
        // Build the base search URL. We intentionally leave out the time at first
        // to get all offers for the day, making our search more robust.
        let searchUrl = `${AMADEUS_API_BASE_URL}/v2/shopping/flight-offers` +
            `?originLocationCode=${departureAirport}` +
            `&destinationLocationCode=${arrivalAirport}` +
            `&departureDate=${departureDate}` +
            `&adults=1` +
            `&currencyCode=USD`;

        // We increase max results to have a better chance of finding a time match.
        if (departureTime) {
            searchUrl += `&max=10`; 
        } else {
            searchUrl += `&max=1`;
        }

        if (airline) searchUrl += `&includeAirlineCodes=${airline}`;
        if (travelClass) searchUrl += `&travelClass=${travelClass}`;
        if (returnDate) searchUrl += `&returnDate=${returnDate}`;
        
        console.log(`Searching for flights: ${departureAirport} -> ${arrivalAirport} on ${departureDate}`);
        
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

        if (!data.data || data.data.length === 0) {
            console.log(`No flight offers returned for the specified criteria.`);
            return null;
        }

        // --- NEW LOGIC: Find the best flight offer ---
        let bestFlightOffer;

        if (departureTime) {
            console.log(`Filtering results for flights near preferred time: ${departureTime}`);
            // Convert the user's target time to minutes for easy comparison.
            const targetTimeInMinutes = parseInt(departureTime.split(':')[0]) * 60 + parseInt(departureTime.split(':')[1]);
            let closestTimeDiff = Infinity;

            for (const offer of data.data) {
                // The departure time is in the first segment of the first itinerary.
                const offerDepartureTime = offer.itineraries[0].segments[0].departure.at.split('T')[1];
                const offerTimeInMinutes = parseInt(offerDepartureTime.split(':')[0]) * 60 + parseInt(offerDepartureTime.split(':')[1]);
                const timeDiff = Math.abs(targetTimeInMinutes - offerTimeInMinutes);

                if (timeDiff < closestTimeDiff) {
                    closestTimeDiff = timeDiff;
                    bestFlightOffer = offer;
                }
            }
            console.log(`Found best match flight departing at: ${bestFlightOffer.itineraries[0].segments[0].departure.at.split('T')[1]}`);
        } else {
            // If no time is specified, just grab the first (and likely cheapest) result.
            bestFlightOffer = data.data[0];
        }

        return {
            currentPrice: parseFloat(bestFlightOffer.price.total),
            currency: bestFlightOffer.price.currency,
            lastChecked: new Date().toISOString(),
        };

    } catch (error) {
        console.error(`Error in getFlightPrice for ${departureAirport}-${arrivalAirport}:`, error);
        return null;
    }
};

module.exports = {
    getFlightPrice,
};
