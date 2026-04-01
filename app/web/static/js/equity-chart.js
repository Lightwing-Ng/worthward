document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('returnsChart');
    if (!canvas) return;

    fetch('/api/investment/transactions')
        .then(res => res.json())
        .then(data => {
            // Assume we have BOXX.parquet data + investment.json
            // Simplified: Fetch historical closing price for equity calculation
            fetch('/api/investment/equity-series')
                .then(res => res.json())
                .then(seriesData => {
                    new Chart(canvas, {
                        type: 'line',
                        data: {
                            labels: seriesData.dates,
                            datasets: [{
                                label: 'Total Equity',
                                data: seriesData.values,
                                borderColor: '#ff2f92',
                                fill: false,
                                tension: 0.1
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: {
                                tooltip: { enabled: true, mode: 'index', intersect: false }
                            }
                        }
                    });
                })
                .catch(e => {
                    // Fallback or ignore for now if /api/investment/equity-series is not implemented
                    console.log('Could not fetch equity series', e);
                });
        })
        .catch(e => {
            console.log('Could not fetch transactions', e);
        });
});