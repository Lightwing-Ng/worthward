/* Code version: v1.0.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	bootstrap.initMoreWorkspace = () => {
		const timingLayoutRow = document.getElementById("timing_layout_row");
		const timingShell = document.getElementById("timing_shell");
		const timingListShell = document.getElementById("timing_list_shell");
		const timingListToggle = document.getElementById("timing_list_toggle");
		const timingToggleIcon = timingListToggle?.querySelector(".icon-timing-toggle") || null;
		const timingSuggestionsPanel = document.getElementById("timing_suggestions_panel");
		if (!timingListShell || !timingListToggle || !timingSuggestionsPanel) return;
		if (timingListToggle.dataset.bound === "1") return;

		let isTimingListOpen = true;
		timingListToggle.dataset.bound = "1";
		timingSuggestionsPanel.setAttribute("aria-hidden", "false");
		if ("inert" in timingSuggestionsPanel) timingSuggestionsPanel.inert = false;

		const syncTimingListState = () => {
			timingListToggle.setAttribute("aria-expanded", String(isTimingListOpen));
			timingListShell.classList.toggle("is-open", isTimingListOpen);
			timingListShell.classList.toggle("is-collapsed", !isTimingListOpen);
			timingShell?.classList.toggle("is-list-collapsed", !isTimingListOpen);
			timingLayoutRow?.classList.toggle("is-list-collapsed", !isTimingListOpen);
			timingSuggestionsPanel.setAttribute("aria-hidden", String(!isTimingListOpen));
			if ("inert" in timingSuggestionsPanel) timingSuggestionsPanel.inert = !isTimingListOpen;
			if (timingToggleIcon) {
				timingToggleIcon.classList.toggle("icon-timing-toggle-right", isTimingListOpen);
				timingToggleIcon.classList.toggle("icon-timing-toggle-left", !isTimingListOpen);
			}
		};

		syncTimingListState();
		timingListToggle.addEventListener("click", () => {
			isTimingListOpen = !isTimingListOpen;
			syncTimingListState();
		});
	};
})();
