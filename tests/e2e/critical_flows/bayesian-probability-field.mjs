/* Code version: v1.0.0 */
import {test} from './support.mjs';
import {prepareBayesianProbabilityField} from './bayesian-probability-setup.mjs';
import {exerciseBayesianProbabilityField} from './bayesian-probability-interactions.mjs';

test('renders, pans, pins, and clears the Bayesian Backtest probability field', async ({page}) => {
    const harness = await prepareBayesianProbabilityField(page);
    await exerciseBayesianProbabilityField(page, harness);
});
