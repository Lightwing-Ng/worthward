/**
 * Investment import adapters for the shared Process List and broker preference.
 * Code version: v1.0.0
 */

const BROKER_STORAGE_KEY = 'worthward:investment-import-broker';

function availableBroker(select, value) {
    return Array.from(select.options).some((option) => (
        option.value === value && !option.disabled && !option.hidden
    ));
}

export function restoreInvestmentImportBroker(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    let remembered = '';
    try {
        remembered = window.localStorage.getItem(BROKER_STORAGE_KEY) || '';
    } catch (_) {
        // A blocked storage partition still gets the product default.
    }
    if (availableBroker(select, remembered)) {
        select.value = remembered;
    } else if (availableBroker(select, 'hsbc')) {
        select.value = 'hsbc';
    }
}

export function rememberInvestmentImportBroker(select) {
    if (!(select instanceof HTMLSelectElement) || !availableBroker(select, select.value)) return;
    try {
        window.localStorage.setItem(BROKER_STORAGE_KEY, select.value);
    } catch (_) {
        // Selection remains usable when persistence is unavailable.
    }
}

function adaptSteps(container, fields) {
    if (!fields.length) return;
    const list = document.createElement('ol');
    list.className = 'process-list investment-import-process-list';
    list.setAttribute('role', 'list');
    container.insertBefore(list, fields[0]);

    fields.forEach((field, index) => {
        const oldMarker = field.querySelector('.investment-import-label-step');
        oldMarker?.remove();
        const heading = field.querySelector('.investment-import-label-trigger');
        heading?.classList.add('process-list-heading');
        if (!heading) {
            field.querySelector('.investment-import-date-row')?.classList.add('process-list-heading');
        }

        const step = document.createElement('li');
        step.className = 'process-list-step';
        if (index < fields.length - 1) step.setAttribute('data-process-continues', '');

        const marker = document.createElement('span');
        marker.className = 'process-list-marker';
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = String(index + 1);

        const content = document.createElement('div');
        content.className = 'process-list-content';
        content.append(field);
        step.append(marker, content);
        list.append(step);
    });
}

export function adaptInvestmentImportProcessLists(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const containers = form.querySelectorAll(
        '.investment-import-field-group, [data-ibkr-import-mode-panel], [data-hsbc-import-mode-panel]',
    );
    containers.forEach((container) => {
        let sequence = [];
        Array.from(container.children).forEach((child) => {
            const numberedField = child.classList.contains('investment-import-field')
                && child.querySelector('.investment-import-label-step');
            if (numberedField) {
                sequence.push(child);
            } else {
                adaptSteps(container, sequence);
                sequence = [];
            }
        });
        adaptSteps(container, sequence);
    });
}
