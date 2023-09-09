# digital-downloads-app-upload-test

1. Install node.js 16 or greater: <https://nodejs.org>
2. Install dependencies: `npm install`
3. Run the test code with `ACCESS_TOKEN` in your environment variables (see below, or add it in a .env file, see .env.example)

## Linux / macOS

`ACCESS_TOKEN=your_access_token_here node index.js`

## CMD (Windows)

On Windows the environment variable is set using the set command.

`set ACCESS_TOKEN=your_access_token_here & node index.js`

## PowerShell (Windows)

In Powershell, it is a bit different.

`$env:ACCESS_TOKEN='your_access_token_here';node index.js`
