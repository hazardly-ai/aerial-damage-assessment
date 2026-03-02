# MapBox Setup

The MapView component requires a MapBox access token to display maps.

## Getting a MapBox Token

1. Go to [MapBox](https://mapbox.com/)
2. Sign up for a free account
3. Navigate to your Account page
4. Find your "Default public token" or create a new one

## Setting up the Token

1. Copy the `.env.example` file content to `.env`:

2. Replace the placeholder token with your actual MapBox token:
   ```
   VITE_MAPBOX_TOKEN=your_actual_mapbox_token_here
   ```

3. Restart your development server if it's running.

## Troubleshooting

If you see "MapBox Token Required" message:
- Ensure your `.env` file exists in the `frontend/` directory
- Verify the token is correctly set
- Check the browser console for any additional errors
- Restart the development server after making changes
