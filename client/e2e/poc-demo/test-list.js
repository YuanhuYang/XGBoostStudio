const { listScenarios } = require('./runner');
console.log('Testing listScenarios...');
const scenarios = listScenarios();
console.log('Found scenarios:', scenarios.length);
console.log(JSON.stringify(scenarios, null, 2));
