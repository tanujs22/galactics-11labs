# Guide for Claude in the Galactics-11Labs Project

## Commands
- `npm start` - Run the application
- `npm test` - Run tests (currently not configured)
- `npm run lint` - Run linting (add with: `npm i -D eslint && npx eslint --init`)

## Code Style Guidelines
- **Imports**: Group imports by type (Node core, external packages, internal modules)
- **Formatting**: Use 2-space indentation, semicolons, single quotes
- **Error Handling**: Use try/catch blocks with detailed error logging
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Types**: JS native types with JSDoc comments for type documentation
- **File Structure**: One module per file, exports at bottom
- **Logging**: Use console.log/error with descriptive prefixes in brackets
- **WebSockets**: Handle connection, message, close, and error events

## Project Structure
This is a Node.js application using Express and WebSockets to integrate with the ElevenLabs API for voice streaming capabilities. The project handles real-time audio processing with a jitter buffer implementation.

## Environment Setup
The project uses dotenv for environment variables. Ensure a .env file exists with:
- PORT - The port to run the server on