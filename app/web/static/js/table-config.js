document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('transactionTable');
    if (!table) return;

    // Use SortableJS for drag-and-drop columns
    // Assuming SortableJS is loaded or we fetch it via CDN
    new Sortable(table.querySelector('thead tr'), {
        handle: 'th',
        animation: 150,
        filter: ':nth-child(1), :nth-child(2)', // Lock No. and Date
        onEnd: (evt) => {
            // Re-order logic if needed
        }
    });
});
